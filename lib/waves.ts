import * as THREE from 'three';

// Shared Gerstner wave set. The GPU ocean and the CPU ship motion use the same maths.
export const WAVE_DEFS = [
  { dx: 1.0, dz: 0.2, len: 46, q: 0.2 },
  { dx: 0.7, dz: 0.7, len: 29, q: 0.17 },
  { dx: -0.3, dz: 1.0, len: 17, q: 0.14 },
  { dx: 0.9, dz: -0.5, len: 10, q: 0.1 },
  { dx: -0.8, dz: -0.6, len: 6, q: 0.07 },
];

export const WAVE_UNIFORMS = WAVE_DEFS.map((w) => {
  const l = Math.hypot(w.dx, w.dz);
  return new THREE.Vector4(w.dx / l, w.dz / l, (2 * Math.PI) / w.len, w.q);
});

const waveSpeed = (k: number) => 0.9 * Math.sqrt(9.81 / k);

export function waveHeight(x: number, z: number, t: number, amp = 1): number {
  let px = x;
  let pz = z;
  for (let it = 0; it < 2; it++) {
    let dx = 0;
    let dz = 0;
    for (const w of WAVE_UNIFORMS) {
      const k = w.z;
      const q = w.w * amp;
      const f = k * (w.x * px + w.y * pz - waveSpeed(k) * t);
      const a = q / k;
      dx += w.x * a * Math.cos(f);
      dz += w.y * a * Math.cos(f);
    }
    px = x - dx;
    pz = z - dz;
  }
  let h = 0;
  for (const w of WAVE_UNIFORMS) {
    const k = w.z;
    const q = w.w * amp;
    const f = k * (w.x * px + w.y * pz - waveSpeed(k) * t);
    h += (q / k) * Math.sin(f);
  }
  return h;
}
