// Procedural ambience: sea, wind, hull creaks, cannon fire. No audio files, everything is synthesized with WebAudio.

export interface AudioState {
  speed: number; // m/s
  heel: number; // rad
  storm: boolean;
}

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let seaGain: GainNode | null = null;
  let seaFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let muted = false;
  let creakTimer = 2;
  let lfoPhase = 0;

  const makeNoise = (c: AudioContext, brown: boolean) => {
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  };

  const loop = (c: AudioContext, buf: AudioBuffer) => {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  };

  const start = () => {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);

    const brown = makeNoise(ctx, true);
    noiseBuf = makeNoise(ctx, false);

    const sea = loop(ctx, brown);
    seaFilter = ctx.createBiquadFilter();
    seaFilter.type = 'lowpass';
    seaFilter.frequency.value = 520;
    seaGain = ctx.createGain();
    seaGain.gain.value = 0.3;
    sea.connect(seaFilter).connect(seaGain).connect(master);

    const wind = loop(ctx, noiseBuf);
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.7;
    windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(windGain).connect(master);
  };

  const creak = () => {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 90;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (0.7 + Math.random() * 0.7), t + 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 260 + Math.random() * 300;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);
    o.connect(bp).connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.7);
  };

  const boom = (pan = 0) => {
    if (!ctx || !master || !noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(lp).connect(g).connect(p).connect(master);
    src.start(t, Math.random() * 2);
    src.stop(t + 1);
    const th = ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(95, t);
    th.frequency.exponentialRampToValueAtTime(32, t + 0.35);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.8, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    th.connect(tg).connect(p);
    th.start(t);
    th.stop(t + 0.5);
  };

  const update = (dt: number, s: AudioState) => {
    if (!ctx || !seaGain || !seaFilter || !windGain || !windFilter) return;
    lfoPhase += dt * 0.35;
    const swell = 0.5 + 0.5 * Math.sin(lfoPhase) * Math.sin(lfoPhase * 0.37 + 1.3);
    const sp = Math.min(1, s.speed / 20);
    const storm = s.storm ? 1 : 0;
    const now = ctx.currentTime;
    seaGain.gain.setTargetAtTime(0.18 + 0.22 * swell + 0.35 * sp + 0.2 * storm, now, 0.4);
    seaFilter.frequency.setTargetAtTime(380 + 600 * sp + 400 * swell + 500 * storm, now, 0.4);
    windGain.gain.setTargetAtTime(0.03 + 0.1 * sp + 0.14 * storm + 0.015 * swell, now, 0.5);
    windFilter.frequency.setTargetAtTime(500 + 900 * sp + 500 * storm + 200 * Math.sin(lfoPhase * 1.7), now, 0.5);
    creakTimer -= dt;
    if (creakTimer <= 0) {
      creakTimer = 1.6 + Math.random() * (5 - 3 * Math.min(1, Math.abs(s.heel) * 6));
      creak();
    }
  };

  const toggleMute = () => {
    muted = !muted;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.1);
    return muted;
  };

  const dispose = () => {
    if (ctx) void ctx.close();
    ctx = null;
  };

  return { start, update, boom, toggleMute, dispose };
}
