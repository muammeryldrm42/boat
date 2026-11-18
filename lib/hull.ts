import * as THREE from 'three';

// Original ghost galleon hull definition. Local space: +z is the bow, +x is starboard,
// y = 0 is the waist deck level. u runs stern (0) to bow (1), v runs keel (0) to rail (1).
export const L = 36;
export const B = 5.3;
export const D0 = 4.7;
export const WATERLINE = -2.55;

export const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const deckLevel = (u: number) =>
  1.7 * (1 - sstep(0.248, 0.262, u)) + 0.95 * sstep(0.868, 0.882, u);

export const topY = (u: number) =>
  deckLevel(u) + 1.05 + 0.5 * Math.pow(1 - u, 3) + 0.55 * Math.pow(u, 5);

export const bottomY = (u: number) =>
  -D0 * (1 - 0.58 * Math.pow(u, 3)) * (1 - 0.1 * Math.pow(1 - u, 2));

export function beam(u: number): number {
  if (u < 0.55) return B * (0.64 + 0.36 * sstep(0, 0.14, u));
  const t = Math.min(1, (u - 0.55) / 0.45);
  return B * Math.pow(Math.max(0, Math.cos((t * Math.PI) / 2)), 0.85);
}

export function sectionV(u: number, v: number) {
  const b = beam(u);
  const bot = bottomY(u);
  const top = topY(u);
  const x = b * Math.pow(Math.sin((v * Math.PI) / 2), 0.7) * (1 - 0.13 * sstep(0.6, 1, v));
  const y = bot + (top - bot) * Math.pow(v, 1.15);
  const z = (u - 0.5) * L + 2.3 * Math.pow(u, 3) * Math.pow(v, 1.7);
  return { x, y, z };
}

export function vAtY(u: number, Y: number): number {
  const bot = bottomY(u);
  const top = topY(u);
  if (Y <= bot) return 0;
  if (Y >= top) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    const y = bot + (top - bot) * Math.pow(m, 1.15);
    if (y < Y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export function surfaceAt(u: number, Y: number) {
  const v = vAtY(u, Y);
  return { v, ...sectionV(u, v) };
}

export function hullNormal(u: number, v: number, side: number): THREE.Vector3 {
  const e = 0.003;
  const u0 = Math.max(0, u - e);
  const u1 = Math.min(1, u + e);
  const v0 = Math.max(0, v - e);
  const v1 = Math.min(1, v + e);
  const a = sectionV(u1, v);
  const b = sectionV(u0, v);
  const c = sectionV(u, v1);
  const d = sectionV(u, v0);
  const du = new THREE.Vector3(side * (a.x - b.x), a.y - b.y, a.z - b.z);
  const dv = new THREE.Vector3(side * (c.x - d.x), c.y - d.y, c.z - d.z);
  const n = new THREE.Vector3().crossVectors(dv, du).normalize();
  if (n.x * side < 0) n.negate();
  return n;
}
