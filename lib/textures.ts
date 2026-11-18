import * as THREE from 'three';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export interface WoodOpts {
  seed: number;
  planks: number;
  base: [number, number, number];
  variance: number;
  weather: number;
}

export function makeWoodTextures(o: WoodOpts) {
  const S = 1024;
  const r = rng(o.seed);
  const c = canvas(S, S);
  const g = c.getContext('2d')!;
  const ph = S / o.planks;
  for (let p = 0; p < o.planks; p++) {
    const y0 = p * ph;
    let x = -r() * 300;
    while (x < S) {
      const segLen = 280 + r() * 460;
      const k = 1 + (r() - 0.5) * o.variance;
      const tint = (r() - 0.5) * 10;
      g.fillStyle = `rgb(${Math.max(0, o.base[0] * k + tint)},${Math.max(0, o.base[1] * k)},${Math.max(0, o.base[2] * k - tint * 0.5)})`;
      g.fillRect(x, y0, segLen, ph);
      for (let i = 0; i < 26; i++) {
        const gy = y0 + r() * ph;
        g.strokeStyle = r() > 0.5 ? `rgba(0,0,0,${0.05 + r() * 0.14})` : `rgba(255,235,200,${0.02 + r() * 0.05})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        const ph0 = r() * 6;
        g.moveTo(x, gy);
        for (let xx = 0; xx <= segLen; xx += 14) g.lineTo(x + xx, gy + Math.sin(xx * 0.03 + ph0) * 1.6);
        g.stroke();
      }
      if (r() > 0.7) {
        const kx = x + 40 + r() * (segLen - 80);
        const ky = y0 + ph * (0.25 + r() * 0.5);
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath();
        g.ellipse(kx, ky, 7 + r() * 6, 3 + r() * 3, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(x, y0, 2.5, ph);
      g.fillStyle = 'rgba(20,16,12,0.9)';
      for (let n = 0; n < 2; n++) {
        g.beginPath();
        g.arc(x + 9, y0 + ph * (0.3 + 0.4 * n), 1.6, 0, Math.PI * 2);
        g.fill();
      }
      x += segLen;
    }
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(0, y0, S, 2.5);
    g.fillStyle = 'rgba(255,230,190,0.05)';
    g.fillRect(0, y0 + 3, S, 1.5);
  }
  for (let i = 0; i < 160 * o.weather; i++) {
    const bx = r() * S;
    const by = r() * S;
    const br = 14 + r() * 70;
    const rg = g.createRadialGradient(bx, by, 0, bx, by, br);
    const dark = r() > 0.35;
    rg.addColorStop(0, dark ? `rgba(8,10,8,${0.12 + r() * 0.18})` : `rgba(120,150,130,${0.04 + r() * 0.08})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(bx - br, by - br, br * 2, br * 2);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const bc = canvas(S, S);
  const bg = bc.getContext('2d')!;
  bg.filter = 'grayscale(1) contrast(1.5)';
  bg.drawImage(c, 0, 0);
  const bump = new THREE.CanvasTexture(bc);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;
  return { map, bump };
}

export interface SailOpts {
  seed: number;
  tatter: number;
  emblem?: boolean;
  w?: number;
  h?: number;
}

export function makeSailTexture(o: SailOpts) {
  const W = o.w ?? 512;
  const H = o.h ?? 640;
  const r = rng(o.seed);
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(196,188,166)';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
    g.fillRect(0, y, W, 1);
  }
  for (let x = 0; x < W; x += 3) {
    g.fillStyle = `rgba(255,250,230,${0.02 + r() * 0.04})`;
    g.fillRect(x, 0, 1, H);
  }
  const panels = 6;
  for (let i = 1; i < panels; i++) {
    const x = (i * W) / panels;
    g.fillStyle = 'rgba(40,34,26,0.45)';
    g.fillRect(x - 1, 0, 2.5, H);
    g.strokeStyle = 'rgba(30,26,20,0.35)';
    g.setLineDash([4, 5]);
    g.beginPath();
    g.moveTo(x + 5, 0);
    g.lineTo(x + 5, H);
    g.moveTo(x - 6, 0);
    g.lineTo(x - 6, H);
    g.stroke();
    g.setLineDash([]);
  }
  for (let i = 0; i < 90; i++) {
    const bx = r() * W;
    const by = Math.pow(r(), 0.6) * H;
    const br = 20 + r() * 90;
    const rg = g.createRadialGradient(bx, by, 0, bx, by, br);
    const kind = r();
    const col = kind < 0.6 ? '70,58,40' : kind < 0.82 ? '52,84,78' : '24,22,18';
    rg.addColorStop(0, `rgba(${col},${0.08 + r() * 0.18})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(bx - br, by - br, br * 2, br * 2);
  }
  const bottomShade = g.createLinearGradient(0, H * 0.55, 0, H);
  bottomShade.addColorStop(0, 'rgba(30,50,46,0)');
  bottomShade.addColorStop(1, 'rgba(30,50,46,0.4)');
  g.fillStyle = bottomShade;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    const px = 30 + r() * (W - 100);
    const py = 40 + r() * (H - 160);
    const pw = 40 + r() * 60;
    const ph = 34 + r() * 50;
    g.fillStyle = `rgba(${165 + r() * 25},${156 + r() * 22},${128 + r() * 22},0.75)`;
    g.fillRect(px, py, pw, ph);
    g.strokeStyle = 'rgba(30,24,18,0.7)';
    g.setLineDash([5, 4]);
    g.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
    g.setLineDash([]);
  }
  g.fillStyle = 'rgba(30,24,16,0.55)';
  g.fillRect(0, 0, W, 10);
  g.fillRect(0, 0, 8, H);
  g.fillRect(W - 8, 0, 8, H);
  if (o.emblem) {
    const cx = W / 2;
    const cy = H * 0.42;
    g.save();
    g.globalAlpha = 0.62;
    g.fillStyle = 'rgb(30,66,64)';
    g.beginPath();
    g.arc(cx, cy, 120, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(cx + 52, cy - 14, 104, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = 'rgb(30,66,64)';
    for (let i = 0; i < 3; i++) {
      const sx = cx + 70 + i * 34;
      const sy = cy - 90 + i * 70;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 === 0 ? 15 : 6;
        const a = (k * Math.PI) / 5 - Math.PI / 2;
        g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  const tat = o.tatter;
  g.beginPath();
  g.moveTo(0, H + 2);
  for (let x = 0; x <= W; x += 5) {
    const jag = Math.pow(r(), 2.2) * 120 * tat + Math.sin(x * 0.045 + o.seed) * 16 * tat + 4;
    g.lineTo(x, H - jag);
  }
  g.lineTo(W, H + 2);
  g.closePath();
  g.fill();
  const tears = Math.round(5 * tat) + 2;
  for (let i = 0; i < tears; i++) {
    const tx = 20 + r() * (W - 40);
    const tw = 5 + r() * 16;
    const th = H * (0.12 + r() * 0.34 * tat);
    g.beginPath();
    g.moveTo(tx - tw, H + 2);
    g.lineTo(tx + (r() - 0.5) * 6, H - th);
    g.lineTo(tx + tw, H + 2);
    g.closePath();
    g.fill();
  }
  for (let side = 0; side < 2; side++) {
    g.beginPath();
    const x0 = side === 0 ? 0 : W;
    const dir = side === 0 ? 1 : -1;
    g.moveTo(x0, 0);
    for (let y = 0; y <= H; y += 7) g.lineTo(x0 + dir * (Math.pow(r(), 2.5) * 34 * tat + 1), y);
    g.lineTo(x0, H);
    g.closePath();
    g.fill();
  }
  const holes = Math.round(9 * tat) + 3;
  for (let i = 0; i < holes; i++) {
    const hx = 30 + r() * (W - 60);
    const hy = 40 + r() * (H - 120);
    const hr = 9 + r() * 34;
    g.beginPath();
    for (let a = 0; a < 18; a++) {
      const ang = (a / 18) * Math.PI * 2;
      const rr = hr * (0.55 + r() * 0.7);
      g.lineTo(hx + Math.cos(ang) * rr * 1.2, hy + Math.sin(ang) * rr);
    }
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function makeFoamTexture() {
  const W = 512;
  const H = 128;
  const r = rng(77);
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  for (let i = 0; i < 1400; i++) {
    const x = r() * W;
    const y = r() * H;
    const rad = 3 + r() * 14;
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `rgba(255,255,255,${0.1 + r() * 0.22})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeGlowTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeMistTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d')!;
  const r = rng(5);
  for (let i = 0; i < 60; i++) {
    const x = 128 + (r() - 0.5) * 120;
    const y = 128 + (r() - 0.5) * 120;
    const rad = 30 + r() * 50;
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, 'rgba(255,255,255,0.12)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 256, 256);
  }
  g.globalCompositeOperation = 'destination-in';
  const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
