// Simple but believable square-rigger sailing model.
// Heading 0 = +z (north). Forward vector = (sin h, cos h). Turning right decreases heading.

export interface VesselPhysics {
  maxSpeed: number; // m/s at full sail on the best point of sail
  accel: number; // 1/s response of speed towards target
  turnRate: number; // rad/s at full rudder and good speed
  rudderRate: number; // rudder units per second
  sailRate: number; // sail set units per second
}

export interface SailingInput {
  sailUp: boolean;
  sailDown: boolean;
  left: boolean;
  right: boolean;
}

const wrapPi = (a: number) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// true wind angle (rad, 0 = straight into the wind) -> drive efficiency for a square rigger
const POLAR: [number, number][] = [
  [0, 0],
  [0.75, 0],
  [1.15, 0.32],
  [1.57, 0.78],
  [2.3, 1.0],
  [3.1416, 0.86],
];
export function polar(twa: number): number {
  for (let i = 1; i < POLAR.length; i++) {
    if (twa <= POLAR[i][0]) {
      const [a0, v0] = POLAR[i - 1];
      const [a1, v1] = POLAR[i];
      const t = (twa - a0) / (a1 - a0);
      const s = t * t * (3 - 2 * t);
      return v0 + (v1 - v0) * s;
    }
  }
  return POLAR[POLAR.length - 1][1];
}

export function pointOfSail(twa: number): string {
  if (twa < 0.8) return 'In irons';
  if (twa < 1.3) return 'Close reach';
  if (twa < 1.9) return 'Beam reach';
  if (twa < 2.6) return 'Broad reach';
  return 'Running';
}

export class Sailing {
  x = 0;
  z = 0;
  heading = 0;
  speed = 2.4;
  sail = 0.75;
  rudder = 0;
  drive = 0;
  windBase = 2.3; // direction the wind comes FROM, same convention as heading
  windFrom = 2.3;
  windStrength = 1;
  twa = 2.3;
  windSide = 0; // -1..1, +1 when the wind arrives on the local +x side

  step(dt: number, t: number, input: SailingInput, phys: VesselPhysics) {
    this.windFrom = this.windBase + 0.12 * Math.sin(t * 0.031) + 0.05 * Math.sin(t * 0.0117 + 2);
    this.windStrength = 0.9 + 0.1 * Math.sin(t * 0.07 + 1);

    this.sail = clamp(this.sail + ((input.sailUp ? 1 : 0) - (input.sailDown ? 1 : 0)) * phys.sailRate * dt, 0, 1);

    const rel = wrapPi(this.windFrom - this.heading);
    this.twa = Math.abs(rel);
    this.drive = polar(this.twa);
    const target = phys.maxSpeed * this.sail * this.drive * this.windStrength;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * phys.accel));
    this.speed = Math.max(0, this.speed);

    const rTarget = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dr = rTarget - this.rudder;
    const maxStep = phys.rudderRate * dt;
    this.rudder += clamp(dr, -maxStep, maxStep);
    if (rTarget === 0) this.rudder *= Math.exp(-dt * 0.9);

    const authority = 0.12 + 0.88 * clamp(this.speed / 2.5, 0, 1);
    this.heading += -this.rudder * phys.turnRate * authority * dt;
    this.speed *= 1 - Math.abs(this.rudder) * 0.04 * dt;

    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    // wind side relative to the ship for heeling (local +x = (cos h, -sin h) in world xz)
    const wx = Math.sin(this.windFrom);
    const wz = Math.cos(this.windFrom);
    this.windSide = clamp(wx * Math.cos(this.heading) - wz * Math.sin(this.heading), -1, 1);
  }
}
