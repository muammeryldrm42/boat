import * as THREE from 'three';
import { createShip, mastDefs, railX, railY, type Ship } from './ship';
import type { CrewSpawn } from './crew';
import type { VesselPhysics } from './sailing';
import { L, sectionV, hullNormal } from './hull';

// Registry of drivable vessels. Add a new ship by writing a builder (like createShip),
// a crew layout, and a physics profile, then push a VesselSpec into VESSELS.
export interface VesselSpec {
  id: string;
  name: string;
  create: () => Ship;
  crew: CrewSpawn[];
  physics: VesselPhysics;
  sternZ: number; // local z of the stern, used for the wake
  waveSample: { x: number; z: number }; // local sample offsets for pitch/roll from waves
  cannons: { side: number; pos: THREE.Vector3; dir: THREE.Vector3 }[]; // local space, side +1 = +x
  restHeight: number; // world y of the ship origin at rest (waterline offset)
  camera: { offset: THREE.Vector3; targetY: number; minDistance: number; maxDistance: number };
}

const SKIN = [0xe0b08a, 0xc68b62, 0x8d5a3b, 0xf0c8a8, 0x6b4430, 0xd4a077];
const SHIRT = [0xcfc6b0, 0x7d8a96, 0x7a3b34, 0x9a8660, 0xb9b09a, 0x5d6b5a];
const PANTS = [0x3a2e24, 0x1f2733, 0x4a4a46, 0x8f8466, 0x2e2a26, 0x55493a];
const HAIR = [0x2a1c12, 0x4a3524, 0x1a1512, 0x8a6a40, 0x5a5047, 0x6a3a20];

const crewStyle = (i: number, extra: Partial<CrewSpawn['style']> = {}): CrewSpawn['style'] => ({
  skin: SKIN[i % SKIN.length],
  shirt: SHIRT[(i * 2 + 1) % SHIRT.length],
  pants: PANTS[(i * 3) % PANTS.length],
  boots: 0x1c1612,
  hair: HAIR[(i * 5 + 2) % HAIR.length],
  hat: i % 3 === 0 ? 'bandana' : i % 3 === 1 ? 'cap' : 'none',
  hatColor: [0x8a2a24, 0x2a3a4a, 0x33402e, 0x4a3a2a][i % 4],
  rolled: i % 2 === 0,
  scale: 0.96 + ((i * 37) % 10) / 100,
  ...extra,
});

function yardCrew(m: { z: number; base: number }, yardY: number, len: number, xs: number[], seed: number): CrewSpawn[] {
  return xs.map((x, i) => ({
    role: 'yard' as const,
    pos: [Math.max(-len / 2 + 1, Math.min(len / 2 - 1, x)), m.base + yardY - 1.1, m.z + 0.62 - 0.6] as [number, number, number],
    phase: seed + i * 1.9,
    style: crewStyle(seed + i, { hat: i % 2 ? 'bandana' : 'none', rolled: true }),
  }));
}

function galleonCrew(): CrewSpawn[] {
  const fore = mastDefs[0];
  const main = mastDefs[1];
  const climbLine = (m: typeof main, side: number): CrewSpawn['line'] => ({
    a: [side * (railX(m.z) + 0.35), railY(m.z) - 0.45, m.z],
    b: [side * 0.3, m.base + m.lower - 1.5, m.z],
    side,
  });
  return [
    {
      role: 'captain',
      pos: [0, 1.7, -10.9],
      range: { axis: 'x', min: -3.3, max: 3.3 },
      style: crewStyle(1, {
        coat: 0x1f3342, hat: 'tricorn', hatColor: 0x14110e, beard: true, plume: true, hair: 0x5a5047, skin: 0xc99068,
        shirt: 0xd8d0bb, scale: 1.04, rolled: false,
      }),
    },
    {
      role: 'mate', pos: [3.3, 1.7, -10.0], yaw: 0.3, phase: 1.3,
      style: crewStyle(4, { coat: 0x5a2a2c, hat: 'tricorn', hatColor: 0x23282d, beard: false, shirt: 0xcfc6b0, rolled: false }),
    },
    { role: 'helm', pos: [0, 1.7, -13.55], style: crewStyle(2, { vest: 0x4a3a2a, hat: 'bandana', hatColor: 0x8a2a24, beard: true }) },
    { role: 'lookout', pos: [1.15, main.base + main.lower - 0.11, main.z + 0.4], yaw: -0.5, style: crewStyle(5, { hat: 'cap', hatColor: 0x2a3a4a }) },
    { role: 'climber', pos: [0, 0, 0], phase: 0.2, line: climbLine(main, 1), style: crewStyle(6, { hat: 'bandana', hatColor: 0x33402e }) },
    { role: 'climber', pos: [0, 0, 0], phase: 3.1, line: climbLine(fore, -1), style: crewStyle(7, { hat: 'none' }) },
    { role: 'hauler', pos: [-3.4, 0, -1.5], phase: 0.0, style: crewStyle(8, { vest: 0x3a2e24 }) },
    { role: 'hauler', pos: [-3.4, 0, -2.5], phase: 0.6, style: crewStyle(9, { hat: 'bandana' }) },
    { role: 'hauler', pos: [-3.4, 0, -3.4], phase: 1.1, style: crewStyle(10, { beard: true }) },
    { role: 'leaner', pos: [4.05, 0, 5.6], yaw: Math.PI / 2, phase: 2.0, style: crewStyle(11) },
    { role: 'leaner', pos: [-4.1, 0, 7.2], yaw: -Math.PI / 2, phase: 4.0, style: crewStyle(12, { hat: 'cap' }) },
    { role: 'swabber', pos: [2.0, 0, -3.0], range: { axis: 'z', min: -7.0, max: -1.2 }, style: crewStyle(13, { hat: 'bandana' }) },
    { role: 'watch', pos: [0.0, 0.95, 16.2], phase: 0.8, style: crewStyle(14, { hat: 'none', beard: true }) },
    { role: 'talker', pos: [-2.3, 0, 6.0], yaw: Math.PI / 4, partner: 0, phase: 0.4, style: crewStyle(15, { vest: 0x2e3a4a, scarf: 0x8a2a24 }) },
    { role: 'talker', pos: [-1.5, 0, 6.8], yaw: Math.PI / 4 + Math.PI, partner: 1, phase: 2.2, style: crewStyle(16, { hat: 'cap', ponytail: true }) },

    // sailors working on the yards (standing on the footropes)
    ...yardCrew(main, 8.6, 17.6, [-5.6, -2.7, 3.1, 6.0], 20),
    ...yardCrew(main, 17.2, 14.2, [-3.2, 3.6], 24),
    ...yardCrew(fore, 7.6, 15.4, [-4.2, 4.0], 28),
    { role: 'sitter', pos: [-0.6, 0.28, 2.4], yaw: Math.PI, phase: 0.5, style: crewStyle(30, { hat: 'bandana' }) },
    { role: 'sitter', pos: [0.9, 0.28, 4.5], yaw: 0, phase: 2.5, style: crewStyle(31, { beard: true }) },
    { role: 'walker', pos: [2.0, 0, 5.0], range: { axis: 'z', min: 1.5, max: 10.5 }, style: crewStyle(32, { scarf: 0x2e4a5a }) },
  ];
}

function galleonCannons() {
  const out: { side: number; pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  for (const side of [1, -1]) {
    for (const u of [0.31, 0.38, 0.45, 0.52, 0.59, 0.66, 0.73, 0.8]) {
      const p = sectionV(u, 0.6);
      const n = hullNormal(u, 0.6, side);
      out.push({ side, pos: new THREE.Vector3(side * p.x, p.y, p.z).addScaledVector(n, 1.4), dir: n.clone() });
    }
  }
  return out;
}

export const GALLEON: VesselSpec = {
  id: 'galleon',
  name: 'Galleon',
  create: createShip,
  crew: galleonCrew(),
  physics: { maxSpeed: 27, accel: 0.8, turnRate: 0.36, rudderRate: 0.8, sailRate: 0.35 },
  sternZ: -L / 2,
  waveSample: { x: 3.6, z: 13 },
  cannons: galleonCannons(),
  restHeight: 2.55,
  camera: { offset: new THREE.Vector3(-30, 12, -42), targetY: 7, minDistance: 8, maxDistance: 130 },
};

export const VESSELS: VesselSpec[] = [GALLEON];
