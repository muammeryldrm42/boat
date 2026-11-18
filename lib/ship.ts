import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  L, B, WATERLINE, sstep, sectionV, vAtY, surfaceAt, deckLevel, topY, bottomY, beam, hullNormal,
} from './hull';
import { makeWoodTextures, makeSailTexture, makeFoamTexture, makeGlowTexture } from './textures';

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface SailRuntime {
  geo: THREE.BufferGeometry;
  base: Float32Array;
  top: Float32Array;
  st: Float32Array;
  dir: THREE.Vector3;
  amp: number;
  phase: number;
  flutter: number;
  sway: number;
}

export interface LanternRuntime {
  light: THREE.PointLight | null;
  core: THREE.Mesh;
  glow: THREE.Sprite;
  baseIntensity: number;
  phase: number;
}

export interface ShipState {
  sail: number; // 0..1 canvas set
  drive: number; // 0..1 how well the wind fills the sails
  rudder: number; // -1..1
  speed: number; // m/s
}

export interface Ship {
  group: THREE.Group;
  update: (t: number, dt: number, state: ShipState) => void;
  dispose: () => void;
}

const TATTER_SCALE = 0.3;

export const mastDefs = [
  { name: 'fore', z: 8.4, base: 0, lower: 17, top: 10.2, r: 0.46 },
  { name: 'main', z: -0.6, base: 0, lower: 20.5, top: 12, r: 0.56 },
  { name: 'mizzen', z: -9.6, base: 1.7, lower: 13.5, top: 8.5, r: 0.38 },
];
export const railX = (z: number) => {
  const u = z / L + 0.5;
  return sectionV(u, 0.985).x + 0.05;
};
export const railY = (z: number) => topY(z / L + 0.5);

export function createShip(): Ship {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => {
    disposables.push(o);
    return o;
  };
  const shadowed = <T extends THREE.Mesh>(m: T, cast = true, receive = true) => {
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  };

  // ---------- materials ----------
  const hullTex = makeWoodTextures({ seed: 11, planks: 6, base: [86, 68, 52], variance: 0.4, weather: 1.1 });
  const deckTex = makeWoodTextures({ seed: 23, planks: 6, base: [96, 84, 66], variance: 0.35, weather: 0.8 });
  const trimTex = makeWoodTextures({ seed: 37, planks: 3, base: [34, 27, 21], variance: 0.25, weather: 0.5 });
  const glowTex = track(makeGlowTexture());
  const foamTex = track(makeFoamTexture());
  [hullTex, deckTex, trimTex].forEach((t) => [t.map, t.bump].forEach((x) => track(x)));

  hullTex.map.repeat.set(8.5, 9);
  hullTex.bump.repeat.set(8.5, 9);
  deckTex.map.repeat.set(1, 1);
  deckTex.bump.repeat.set(1, 1);

  const hullMat = track(new THREE.MeshStandardMaterial({
    map: hullTex.map, bumpMap: hullTex.bump, bumpScale: 2.2, roughness: 0.82, metalness: 0.02,
    vertexColors: true, side: THREE.DoubleSide,
  }));
  const deckMat = track(new THREE.MeshStandardMaterial({
    map: deckTex.map, bumpMap: deckTex.bump, bumpScale: 1.6, roughness: 0.9, side: THREE.DoubleSide,
  }));
  const trimMat = track(new THREE.MeshStandardMaterial({
    map: trimTex.map, bumpMap: trimTex.bump, bumpScale: 1.2, roughness: 0.7, color: 0xb8a590,
  }));
  const darkWood = track(new THREE.MeshStandardMaterial({ color: 0x1d1611, roughness: 0.78 }));
  const mastMat = track(new THREE.MeshStandardMaterial({
    map: trimTex.map, bumpMap: trimTex.bump, bumpScale: 1.0, roughness: 0.75, color: 0x9a8a78,
  }));
  const ironMat = track(new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.45, metalness: 0.85 }));
  const ropeMat = track(new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.95 }));
  const portMat = track(new THREE.MeshStandardMaterial({ color: 0x050707, roughness: 1 }));

  // ---------- hull shell ----------
  {
    const nu = 150;
    const ns = 64;
    const pos: number[] = [];
    const uvs: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      for (let j = 0; j <= ns; j++) {
        const s = -1 + (2 * j) / ns;
        const v = Math.abs(s);
        const side = s < 0 ? -1 : 1;
        const p = sectionV(u, v);
        pos.push(side * p.x, p.y, p.z);
        uvs.push(u, (s + 1) * 0.5);
        const wet = sstep(WATERLINE + 0.6, WATERLINE - 1.2, p.y);
        const slime = sstep(WATERLINE + 0.3, WATERLINE - 0.1, p.y) * (1 - sstep(WATERLINE - 0.1, WATERLINE - 0.7, p.y));
        cols.push(1 - wet * 0.55 + slime * 0.0, 1 - wet * 0.35 + slime * 0.12, 1 - wet * 0.42 + slime * 0.1);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < ns; j++) {
        const a = i * (ns + 1) + j;
        const b = a + 1;
        const c = a + (ns + 1);
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    track(g);
    group.add(shadowed(new THREE.Mesh(g, hullMat)));
  }

  // stern transom cap
  {
    const pts: THREE.Vector2[] = [];
    for (let j = 0; j <= 24; j++) {
      const s = -1 + (2 * j) / 24;
      const p = sectionV(0, Math.abs(s));
      pts.push(new THREE.Vector2(Math.sign(s) * p.x, p.y));
    }
    const shape = new THREE.Shape(pts);
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.18, uv.getY(i) * 0.4);
    track(g);
    const mesh = shadowed(new THREE.Mesh(g, trimMat));
    mesh.position.z = -L / 2;
    mesh.rotation.y = Math.PI;
    group.add(mesh);
  }

  // ---------- tube helper ----------
  const addTube = (pts: THREE.Vector3[], r: number, mat: THREE.Material, seg = 100, radial = 6) => {
    const g = track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial, false));
    const m = shadowed(new THREE.Mesh(g, mat));
    group.add(m);
    return m;
  };
  const hullLine = (v: number, side: number, off: number, u0 = 0, u1 = 1, n = 80) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      const p = sectionV(u, v);
      const nrm = hullNormal(u, Math.max(v, 0.02), side);
      pts.push(V3(side * p.x + nrm.x * off, p.y + nrm.y * off, p.z + nrm.z * off));
    }
    return pts;
  };
  for (const side of [-1, 1]) {
    addTube(hullLine(0.46, side, 0.07, 0.04, 0.95), 0.09, trimMat);
    addTube(hullLine(0.72, side, 0.07, 0.04, 0.97), 0.11, trimMat);
    addTube(hullLine(0.985, side, 0.05, 0, 1), 0.15, trimMat);
    addTube(hullLine(0.2, side, 0.05, 0.06, 0.9), 0.07, darkWood);
  }
  {
    const stem: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const p = sectionV(1, i / 30);
      stem.push(V3(0, p.y, p.z + 0.05));
    }
    addTube(stem, 0.2, trimMat, 40, 8);
    const keel: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const p = sectionV(u, 0);
      keel.push(V3(0, p.y - 0.05, p.z));
    }
    addTube(keel, 0.2, darkWood, 80, 8);
  }

  // ---------- decks ----------
  const addDeck = (u0: number, u1: number, Y: number) => {
    const n = 40;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      const sp = surfaceAt(u, Y);
      const x = sp.x * 0.99;
      pos.push(-x, Y, sp.z, x, Y, sp.z);
      uv.push(sp.z / 4.2, -x * 0.46, sp.z / 4.2, x * 0.46);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    track(g);
    group.add(shadowed(new THREE.Mesh(g, deckMat)));
  };
  addDeck(0, 0.258, 1.7);
  addDeck(0.255, 0.874, 0);
  addDeck(0.872, 1, 0.95);
  const uz = (u: number) => (u - 0.5) * L;

  // bulkheads and stairs
  const wallW = (u: number, Y: number) => surfaceAt(u, Y).x * 0.99;
  {
    const wz = uz(0.258);
    const w = wallW(0.258, 0.85) * 2;
    const m = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(w, 1.8, 0.3)), trimMat));
    m.position.set(0, 0.85, wz);
    group.add(m);
    for (const dx of [-2.4, 2.4]) {
      const door = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(1.1, 1.3, 0.34)), darkWood));
      door.position.set(dx, 0.65, wz + 0.02);
      group.add(door);
    }
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      for (let s = 0; s < 5; s++) {
        const st = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.34 * (s + 1), 0.5)), deckMat));
        st.position.set(side * (wallW(0.258, 0.9) - 1.05), 0.17 * (s + 1), wz + 0.5 + s * 0.5);
        group.add(st);
      }
    }
    const fw = wallW(0.874, 0.5) * 2;
    const f = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(fw, 1.0, 0.3)), trimMat));
    f.position.set(0, 0.5, uz(0.874));
    group.add(f);
  }

  // transom windows with warm light, rails
  const windowMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.15, 0.38) }));
  const frameGeo = track(new THREE.BoxGeometry(1.05, 1.35, 0.14));
  const paneGeo = track(new THREE.PlaneGeometry(0.82, 1.1));
  for (const wx of [-2.05, -0.68, 0.68, 2.05]) {
    const frame = shadowed(new THREE.Mesh(frameGeo, darkWood));
    frame.position.set(wx, 1.15, -L / 2 - 0.05);
    group.add(frame);
    const pane = new THREE.Mesh(paneGeo, windowMat);
    pane.position.set(wx, 1.15, -L / 2 - 0.13);
    pane.rotation.y = Math.PI;
    group.add(pane);
  }
  {
    const sillL = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(6.6, 0.16, 0.5)), trimMat));
    sillL.position.set(0, 0.4, -L / 2 - 0.2);
    group.add(sillL);
    const cornice = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(7.4, 0.28, 0.6)), trimMat));
    cornice.position.set(0, 2.2, -L / 2 - 0.25);
    group.add(cornice);
  }

  // ---------- ports and cannons ----------
  const portGeo = track(new THREE.BoxGeometry(0.95, 0.8, 0.22));
  const lidGeo = track(new THREE.BoxGeometry(1.0, 0.1, 0.06));
  const cannonGeo = track(new THREE.CylinderGeometry(0.15, 0.24, 1.7, 10));
  const cannonTipGeo = track(new THREE.TorusGeometry(0.17, 0.045, 6, 12));
  const ghostPortMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.012, 0.012) }));
  const portUs = [0.31, 0.38, 0.45, 0.52, 0.59, 0.66, 0.73, 0.8];
  for (const side of [-1, 1]) {
    portUs.forEach((u, idx) => {
      const v = 0.6;
      const p = sectionV(u, v);
      const n = hullNormal(u, v, side);
      const base = V3(side * p.x, p.y, p.z);
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n);
      const port = shadowed(new THREE.Mesh(portGeo, portMat));
      port.position.copy(base).addScaledVector(n, 0.0);
      port.quaternion.copy(q);
      group.add(port);
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.5), ghostPortMat);
      track(inner.geometry);
      inner.position.copy(base).addScaledVector(n, -0.04);
      inner.quaternion.copy(q);
      group.add(inner);
      if (idx % 2 === 0 || true) {
        const lid = shadowed(new THREE.Mesh(lidGeo, darkWood));
        lid.position.copy(base).addScaledVector(n, 0.34).add(V3(0, 0.42, 0));
        lid.quaternion.copy(q);
        lid.rotateX(-1.0);
        group.add(lid);
      }
      const cannon = shadowed(new THREE.Mesh(cannonGeo, ironMat));
      cannon.position.copy(base).addScaledVector(n, 0.35);
      cannon.quaternion.copy(q);
      cannon.rotateX(Math.PI / 2);
      group.add(cannon);
      const tip = shadowed(new THREE.Mesh(cannonTipGeo, ironMat));
      tip.position.copy(base).addScaledVector(n, 1.2);
      tip.quaternion.copy(q);
      group.add(tip);
    });
  }

  // chain plates (channels) along the rails by the masts
  for (const m of mastDefs) {
    for (const side of [-1, 1]) {
      const ch = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(0.7, 0.13, 4.6)), trimMat));
      ch.position.set(side * (railX(m.z) + 0.25), railY(m.z) - 0.55, m.z);
      group.add(ch);
    }
  }

  // ---------- masts, yards, tops ----------
  const cyl = (rTop: number, rBot: number, h: number, pos: THREE.Vector3, mat: THREE.Material, seg = 14) => {
    const mesh = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(rTop, rBot, h, seg)), mat));
    mesh.position.copy(pos).add(V3(0, h / 2, 0));
    group.add(mesh);
    return mesh;
  };
  for (const m of mastDefs) {
    cyl(m.r * 0.72, m.r, m.lower, V3(0, m.base, m.z), mastMat);
    cyl(m.r * 0.46, m.r * 0.62, m.top, V3(0, m.base + m.lower - 2.2, m.z), mastMat);
    cyl(m.r * 0.12, m.r * 0.3, 4.6, V3(0, m.base + m.lower + m.top - 5.4, m.z), mastMat, 10);
    const top = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(1.7 * m.r + 0.9, 1.7 * m.r + 0.9, 0.18, 14)), trimMat));
    top.position.set(0, m.base + m.lower - 0.2, m.z);
    group.add(top);
    const rim = shadowed(new THREE.Mesh(track(new THREE.TorusGeometry(1.7 * m.r + 0.9, 0.06, 6, 20)), darkWood));
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(top.position).add(V3(0, 0.12, 0));
    group.add(rim);
    const band = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(m.r * 1.05, m.r * 1.05, 0.2, 12)), ironMat));
    band.position.set(0, m.base + 0.9, m.z);
    group.add(band);
  }
  const addYard = (y: number, z: number, len: number, r = 0.17) => {
    for (const s of [-1, 1]) {
      const geo = track(new THREE.CylinderGeometry(r * 0.5, r, len / 2, 8));
      const m = shadowed(new THREE.Mesh(geo, mastMat));
      m.rotation.z = (s * Math.PI) / 2;
      m.position.set((s * len) / 4, y, z);
      group.add(m);
    }
    const slung = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(r * 1.45, r * 1.45, 0.8, 8)), ironMat));
    slung.rotation.z = Math.PI / 2;
    slung.position.set(0, y, z);
    group.add(slung);
  };

  // bowsprit
  const spritStart = V3(0, 1.5, 12.6);
  const spritDir = V3(0, Math.sin(0.33), Math.cos(0.33));
  const spritLen = 12.2;
  const spritEnd = spritStart.clone().addScaledVector(spritDir, spritLen);
  {
    const geo = track(new THREE.CylinderGeometry(0.1, 0.34, spritLen, 10));
    const m = shadowed(new THREE.Mesh(geo, mastMat));
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), spritDir.clone().negate());
    m.position.copy(spritStart).addScaledVector(spritDir, spritLen / 2);
    group.add(m);
  }
  const spritAt = (f: number) => spritStart.clone().addScaledVector(spritDir, spritLen * f);

  // ---------- rope network (merged) ----------
  const ropeGeos: THREE.BufferGeometry[] = [];
  const rope = (a: THREE.Vector3, b: THREE.Vector3, r = 0.045, sag = 0) => {
    const curve = sag > 0
      ? new THREE.QuadraticBezierCurve3(a, a.clone().add(b).multiplyScalar(0.5).add(V3(0, -sag * a.distanceTo(b) * 2, 0)), b)
      : new THREE.LineCurve3(a, b);
    ropeGeos.push(new THREE.TubeGeometry(curve, sag > 0 ? 8 : 1, r, 4, false));
  };

  const sails: SailRuntime[] = [];
  const sailTexAll: THREE.Texture[] = [];
  const sailMeshes: THREE.Mesh[] = [];
  const makeSail = (
    tl: THREE.Vector3, tr: THREE.Vector3, bl: THREE.Vector3, br: THREE.Vector3,
    texOpts: { seed: number; tatter: number; emblem?: boolean },
    dir: THREE.Vector3, amp: number, phase: number, flutter = 0.22, sway = 0.12,
  ) => {
    const nu = 18;
    const nv = 24;
    const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
    const st = new Float32Array((nu + 1) * (nv + 1) * 2);
    const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
    const idx: number[] = [];
    let k = 0;
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      for (let i = 0; i <= nu; i++) {
        const s = i / nu;
        const top = tl.clone().lerp(tr, s);
        const bot = bl.clone().lerp(br, s);
        const p = top.lerp(bot, t);
        pos[k * 3] = p.x;
        pos[k * 3 + 1] = p.y;
        pos[k * 3 + 2] = p.z;
        st[k * 2] = s;
        st[k * 2 + 1] = t;
        uv[k * 2] = s;
        uv[k * 2 + 1] = 1 - t;
        k++;
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i;
        idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
    const topArr = new Float32Array((nu + 1) * (nv + 1) * 3);
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const k0 = (j * (nu + 1) + i) * 3;
        const k1 = i * 3;
        topArr[k0] = pos[k1];
        topArr[k0 + 1] = pos[k1 + 1];
        topArr[k0 + 2] = pos[k1 + 2];
      }
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const tex = makeSailTexture({ ...texOpts, tatter: texOpts.tatter * TATTER_SCALE });
    track(tex);
    sailTexAll.push(tex);
    const mat = track(new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.96,
      emissive: new THREE.Color(0.1, 0.1, 0.09), emissiveMap: tex, emissiveIntensity: 0.3,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    sailMeshes.push(mesh);
    sails.push({ geo, base: pos, top: topArr, st, dir: dir.clone(), amp, phase, flutter, sway });
    geo.computeVertexNormals();
  };

  const squareSail = (m: typeof mastDefs[number], yardY: number, w: number, h: number, bottomScale: number,
    seed: number, tatter: number, amp: number, emblem = false) => {
    const y = m.base + yardY;
    const z = m.z + 0.62;
    addYard(y, z, w + 2.2);
    const wb = w * bottomScale;
    makeSail(V3(-w / 2, y - 0.1, z), V3(w / 2, y - 0.1, z), V3(-wb / 2, y - h, z), V3(wb / 2, y - h, z),
      { seed, tatter, emblem }, V3(0, 0, 1), amp, seed * 0.7, 0.28, 0.18);
    // footrope and stirrups for the yard crew
    const half = (w + 2.2) / 2;
    rope(V3(-half + 0.9, y - 1.1, z - 0.6), V3(half - 0.9, y - 1.1, z - 0.6), 0.045, 0.012);
    for (const f of [-0.8, -0.5, -0.2, 0.2, 0.5, 0.8]) rope(V3(f * half, y - 0.14, z - 0.12), V3(f * half, y - 1.1, z - 0.6), 0.03);
    // lifts and sheets
    rope(V3(-(w + 2.2) / 2, y, z), V3(-0.25, m.base + m.lower + 0.4, m.z), 0.04, 0.02);
    rope(V3((w + 2.2) / 2, y, z), V3(0.25, m.base + m.lower + 0.4, m.z), 0.04, 0.02);
    rope(V3(-wb / 2, y - h, z), V3(-railX(m.z) * 0.85, m.base + 0.2, m.z - 2.5), 0.04, 0.01);
    rope(V3(wb / 2, y - h, z), V3(railX(m.z) * 0.85, m.base + 0.2, m.z - 2.5), 0.04, 0.01);
    // braces to aft
    rope(V3(-(w + 2.2) / 2, y, z), V3(-railX(m.z - 6) * 0.9, railY(m.z - 6) + 0.2, m.z - 6), 0.035, 0.015);
    rope(V3((w + 2.2) / 2, y, z), V3(railX(m.z - 6) * 0.9, railY(m.z - 6) + 0.2, m.z - 6), 0.035, 0.015);
  };

  const [fore, main, mizzen] = mastDefs;
  squareSail(main, 8.6, 15.4, 6.9, 1.12, 101, 0.95, 2.1, true);
  squareSail(main, 17.2, 12.0, 7.6, 1.15, 202, 0.85, 1.9);
  squareSail(main, 25.0, 8.2, 6.4, 1.15, 303, 0.7, 1.5);
  squareSail(fore, 7.6, 13.2, 6.0, 1.12, 404, 1.0, 1.9);
  squareSail(fore, 14.6, 10.2, 6.6, 1.15, 505, 0.85, 1.7);
  squareSail(fore, 21.2, 7.0, 5.4, 1.15, 606, 0.75, 1.4);
  squareSail(mizzen, 9.2, 8.6, 5.2, 1.1, 707, 0.9, 1.4);

  // spanker (side-billowing gaff sail)
  {
    const z0 = mizzen.z - 0.5;
    const by = mizzen.base;
    addTube([V3(0, by + 4.0, z0 + 0.1), V3(0, by + 3.6, z0 - 3.5), V3(0, by + 3.3, z0 - 7.2)], 0.1, mastMat, 12, 6);
    addTube([V3(0, by + 11.3, z0 - 0.1), V3(0, by + 12.6, z0 - 2.4), V3(0, by + 13.8, z0 - 5.0)], 0.09, mastMat, 12, 6);
    makeSail(V3(0, by + 11.1, z0 - 0.4), V3(0, by + 13.6, z0 - 4.9), V3(0, by + 4.0, z0 - 0.4), V3(0, by + 3.4, z0 - 7.1),
      { seed: 808, tatter: 0.9 }, V3(1, 0, 0), 1.3, 3.1, 0.22, 0.1);
  }
  // jibs (triangular headsails)
  {
    const fh = V3(0, fore.base + fore.lower + fore.top - 3.6, fore.z + 0.5);
    const fh2 = V3(0, fore.base + fore.lower - 1.2, fore.z + 0.5);
    const tip = spritAt(0.97);
    const mid = spritAt(0.62);
    makeSail(fh, fh, tip.clone().add(V3(0, 0.15, 0)), V3(0, fore.base + 3.6, fore.z + 6.2),
      { seed: 909, tatter: 0.8 }, V3(1, 0, 0), 1.0, 1.2, 0.2, 0.1);
    makeSail(fh2, fh2, mid.clone().add(V3(0, 0.15, 0)), V3(0, fore.base + 2.8, fore.z + 4.4),
      { seed: 1001, tatter: 0.8 }, V3(-1, 0, 0), 0.9, 2.2, 0.2, 0.1);
    rope(fh, tip, 0.05, 0.015);
    rope(fh2, mid, 0.05, 0.015);
    rope(V3(0, fore.base + fore.lower + 1.2, fore.z + 0.2), spritAt(0.9).add(V3(0, 0.1, 0)), 0.045, 0.01);
  }

  // shrouds and ratlines
  for (const m of mastDefs) {
    const headY = m.base + m.lower - 0.3;
    for (const side of [-1, 1]) {
      const anchors: THREE.Vector3[] = [];
      for (let k = 0; k < 5; k++) {
        const z = m.z - 1.9 + k * 0.95;
        anchors.push(V3(side * (railX(z) + 0.35), railY(z) - 0.5, z));
        rope(V3(side * 0.18, headY, m.z + (k - 2) * 0.12), anchors[k], 0.05);
      }
      const bottomY0 = Math.max(...anchors.map((a) => a.y)) + 1.2;
      for (let y = bottomY0; y < headY - 1.2; y += 0.95) {
        for (let k = 0; k < 4; k++) {
          const f = (yy: number, a: THREE.Vector3) => {
            const tt = (yy - a.y) / (headY - a.y);
            return V3(a.x + (side * 0.18 - a.x) * tt, yy, a.z + (m.z + (anchors.indexOf(a) - 2) * 0.12 - a.z) * tt);
          };
          rope(f(y, anchors[k]), f(y, anchors[k + 1]), 0.028);
        }
      }
    }
    // backstays
    for (const side of [-1, 1]) {
      const bz = m.z - 5.6;
      rope(V3(side * 0.15, m.base + m.lower + m.top - 3.2, m.z), V3(side * (railX(bz) + 0.4), railY(bz) - 0.4, bz), 0.04, 0.012);
    }
  }
  rope(V3(0, fore.base + fore.lower + fore.top - 3.4, fore.z + 0.2), spritAt(1).add(V3(0, 0.1, 0)), 0.05, 0.012);
  rope(V3(0, main.base + main.lower + 0.5, main.z + 0.2), V3(0, fore.base + 11, fore.z - 0.4), 0.05, 0.02);
  rope(V3(0, mizzen.base + mizzen.lower + 0.5, mizzen.z + 0.2), V3(0, main.base + 12, main.z - 0.4), 0.05, 0.02);
  rope(V3(0, main.base + main.lower + main.top - 3.4, main.z + 0.2), V3(0, fore.base + fore.lower + fore.top - 4.4, fore.z - 0.2), 0.04, 0.02);
  for (const side of [-1, 1]) {
    rope(spritAt(0.92).add(V3(side * 0.05, 0, 0)), V3(side * 3.4, 1.3, 11.4), 0.04, 0.01);
    rope(spritAt(0.9), V3(side * 1.2, 0.5, 15.6), 0.035, 0.01);
  }

  {
    const merged = mergeGeometries(ropeGeos, false);
    ropeGeos.forEach((g) => g.dispose());
    if (merged) {
      track(merged);
      group.add(shadowed(new THREE.Mesh(merged, ropeMat), true, false));
    }
  }

  // ---------- deck props ----------
  const bandGeo = track(new THREE.TorusGeometry(0.43, 0.025, 6, 16));
  const barrelGeo = track(new THREE.CylinderGeometry(0.4, 0.4, 0.95, 14));
  const addBarrel = (x: number, y: number, z: number) => {
    const b = shadowed(new THREE.Mesh(barrelGeo, trimMat));
    b.scale.set(1, 1, 1);
    b.position.set(x, y + 0.48, z);
    group.add(b);
    for (const dy of [-0.28, 0.28]) {
      const band = shadowed(new THREE.Mesh(bandGeo, ironMat));
      band.rotation.x = Math.PI / 2;
      band.position.set(x, y + 0.48 + dy, z);
      group.add(band);
    }
  };
  addBarrel(-3.3, 0, 3.6);
  addBarrel(-3.9, 0, 4.4);
  addBarrel(3.5, 0, -4.6);
  addBarrel(-3.6, 0, 10.5);
  addBarrel(3.2, 0.95, 15.2);
  const crateGeo = track(new THREE.BoxGeometry(0.9, 0.8, 0.9));
  for (const [x, y, z, ry] of [[3.6, 0, 3.8, 0.3], [3.3, 0.8, 3.7, 0.9], [-3.4, 0, -4.2, 0.1], [-3.0, 0.95, 14.8, 0.6]] as number[][]) {
    const c = shadowed(new THREE.Mesh(crateGeo, trimMat));
    c.position.set(x, y + 0.4, z);
    c.rotation.y = ry;
    group.add(c);
  }
  // hatches
  for (const z of [3.4, -4.4]) {
    const hatch = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(2.4, 0.28, 2.0)), trimMat));
    hatch.position.set(0, 0.14, z);
    group.add(hatch);
    const grate = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(2.0, 0.06, 1.6)), darkWood));
    grate.position.set(0, 0.3, z);
    group.add(grate);
  }
  // capstan
  {
    const cap = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.65, 1.2, 12)), trimMat));
    cap.position.set(0, 0.6, 11.2);
    group.add(cap);
    for (let i = 0; i < 4; i++) {
      const bar = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6)), darkWood));
      bar.position.set(0, 1.0, 11.2);
      bar.rotation.z = Math.PI / 2;
      bar.rotation.y = (i * Math.PI) / 4;
      group.add(bar);
    }
  }
  // ship wheel and binnacle
  let wheelRef: THREE.Group | null = null;
  {
    const ped = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 1.1, 0.9)), trimMat));
    ped.position.set(0, 1.7 + 0.55, -11.95);
    group.add(ped);
    const wheel = new THREE.Group();
    const torus = shadowed(new THREE.Mesh(track(new THREE.TorusGeometry(0.62, 0.06, 8, 24)), darkWood));
    wheel.add(torus);
    for (let i = 0; i < 8; i++) {
      const sp = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6)), darkWood));
      sp.rotation.z = (i * Math.PI) / 8;
      wheel.add(sp);
      const handle = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6)), darkWood));
      handle.rotation.x = Math.PI / 2;
      handle.position.set(Math.cos((i * Math.PI) / 4) * 0.8, Math.sin((i * Math.PI) / 4) * 0.8, 0);
      wheel.add(handle);
    }
    const hub = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(0.14, 0.14, 0.2, 10)), ironMat));
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(0, 1.7 + 1.55, -12.75);
    group.add(wheel);
    wheelRef = wheel;
  }
  // rope coils at mast feet
  const coilGeo = track(new THREE.TorusGeometry(0.4, 0.09, 6, 14));
  for (const m of mastDefs) {
    for (const side of [-1, 1]) {
      const c = shadowed(new THREE.Mesh(coilGeo, ropeMat));
      c.rotation.x = Math.PI / 2;
      c.position.set(side * 1.0, m.base + 0.12, m.z - 0.5);
      group.add(c);
    }
  }
  // rudder (pivots at the transom)
  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, -3.4, -L / 2 - 0.05);
  {
    const rud = shadowed(new THREE.Mesh(track(new THREE.BoxGeometry(0.26, 3.4, 1.3)), darkWood));
    rud.position.set(0, 0, -0.65);
    rudderPivot.add(rud);
  }
  group.add(rudderPivot);
  // beakhead rail and stern lantern posts
  for (const side of [-1, 1]) {
    const post = shadowed(new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.13, 2.6, 8)), darkWood));
    post.position.set(side * 3.5, 3.25 + 1.3, -L / 2 + 0.2);
    group.add(post);
  }

  // ---------- lanterns ----------
  const lanterns: LanternRuntime[] = [];
  const coreGeo = track(new THREE.SphereGeometry(0.2, 12, 12));
  const cageGeo = track(new THREE.CylinderGeometry(0.34, 0.28, 0.7, 6, 1, true));
  const glowMat = track(new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color(1.0, 0.7, 0.35), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.4,
  }));
  const addLantern = (pos: THREE.Vector3, color: THREE.Color, withLight: boolean, intensity: number, scale = 3.2, hang = true) => {
    const g = new THREE.Group();
    g.position.copy(pos);
    const coreMat = track(new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.6) }));
    const core = new THREE.Mesh(coreGeo, coreMat);
    g.add(core);
    const cage = new THREE.Mesh(cageGeo, ironMat);
    g.add(cage);
    const capTop = new THREE.Mesh(track(new THREE.ConeGeometry(0.4, 0.28, 6)), ironMat);
    capTop.position.y = 0.48;
    g.add(capTop);
    if (hang) {
      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.1, 0.02, 6, 8)), ironMat);
      ring.position.y = 0.68;
      g.add(ring);
    }
    const sm = glowMat.clone();
    sm.color = color.clone();
    track(sm);
    const glow = new THREE.Sprite(sm);
    glow.scale.setScalar(scale);
    g.add(glow);
    let light: THREE.PointLight | null = null;
    if (withLight) {
      light = new THREE.PointLight(color.getHex(), intensity, 26, 1.6);
      g.add(light);
    }
    group.add(g);
    lanterns.push({ light, core, glow, baseIntensity: intensity, phase: Math.random() * 10 });
  };
  const teal = new THREE.Color(1.0, 0.62, 0.26);
  addLantern(V3(-3.5, 6.0, -L / 2 + 0.2), teal, true, 18);
  addLantern(V3(3.5, 6.0, -L / 2 + 0.2), teal, false, 0);
  addLantern(V3(0, 7.0, main.z + 0.2 + 0.0).setZ(main.z + 1.4), new THREE.Color(1.0, 0.66, 0.3), true, 22, 2.2);
  addLantern(V3(0, main.base + main.lower + main.top + 0.1, main.z), new THREE.Color(1.0, 0.66, 0.3), false, 0, 3.0, false);
  addLantern(V3(0, 2.3, 17.2), teal, true, 16);
  addLantern(V3(-2.4, 1.7 + 2.2, -11.2), new THREE.Color(1.0, 0.62, 0.25), false, 0, 2.2);
  addLantern(V3(2.4, 1.7 + 2.2, -11.2), new THREE.Color(1.0, 0.62, 0.25), false, 0, 2.2);

  // warm cabin glow spilling out of the stern windows
  const cabinLight = new THREE.PointLight(0xff9a42, 26, 18, 1.7);
  cabinLight.position.set(0, 1.4, -L / 2 - 2.0);
  group.add(cabinLight);

  // ---------- hull foam ring ----------
  const foamMeshes: THREE.Mesh[] = [];
  {
    const foamMat = track(new THREE.MeshBasicMaterial({
      map: foamTex, transparent: true, depthWrite: false, opacity: 0.5, color: new THREE.Color(0.7, 0.85, 0.88),
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    }));
    for (const side of [-1, 1]) {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const n = 70;
      for (let i = 0; i <= n; i++) {
        const u = 0.012 + (0.94 - 0.012) * (i / n);
        const sp = surfaceAt(u, WATERLINE + 0.02);
        const width = 0.9 + 0.9 * sstep(0.7, 0.94, u) + 0.4 * Math.sin(u * 40);
        pos.push(side * sp.x, WATERLINE + 0.08, sp.z, side * (sp.x + width), WATERLINE + 0.08, sp.z);
        uv.push(u * 14, 0, u * 14, 1);
        if (i < n) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, foamMat);
      m.renderOrder = 2;
      group.add(m);
      foamMeshes.push(m);
    }
  }

  // ---------- animation ----------
  const tmp = new THREE.Vector3();
  const update = (t: number, dt: number, st: ShipState) => {
    const sc = 0.14 + 0.86 * st.sail;
    const power = (0.3 + 0.7 * st.sail) * (0.3 + 0.7 * st.drive);
    const flutterK = 1 + (1 - st.drive) * st.sail * 2.2;
    for (const s of sails) {
      const pos = s.geo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const gust = 1 + 0.1 * Math.sin(t * 0.6 + s.phase) + 0.04 * Math.sin(t * 1.9 + s.phase * 2);
      const n = arr.length / 3;
      for (let k = 0; k < n; k++) {
        const sx = s.st[k * 2];
        const tt = s.st[k * 2 + 1];
        const bulge = s.amp * power * Math.pow(Math.sin(Math.PI * sx), 0.7) * (0.3 + 0.7 * Math.sin(Math.PI * (0.08 + 0.84 * tt)));
        const fl = s.flutter * flutterK * (0.15 + tt * tt) * Math.sin(t * 2.3 + sx * 6 + tt * 4 + s.phase);
        const off = bulge * gust + fl;
        const i3 = k * 3;
        const bx = s.top[i3] + (s.base[i3] - s.top[i3]) * sc;
        const by = s.top[i3 + 1] + (s.base[i3 + 1] - s.top[i3 + 1]) * sc;
        const bz = s.top[i3 + 2] + (s.base[i3 + 2] - s.top[i3 + 2]) * sc;
        arr[i3] = bx + s.dir.x * off + Math.sin(t * 1.7 + tt * 3 + s.phase) * s.sway * tt;
        arr[i3 + 1] = by + s.dir.y * off + Math.sin(t * 2.1 + sx * 4 + s.phase) * 0.05 * tt;
        arr[i3 + 2] = bz + s.dir.z * off;
      }
      pos.needsUpdate = true;
      s.geo.computeVertexNormals();
    }
    rudderPivot.rotation.y = st.rudder * 0.55;
    if (wheelRef) wheelRef.rotation.z = -st.rudder * 2.6;
    for (const l of lanterns) {
      const f = 0.82 + 0.18 * Math.sin(t * 5.3 + l.phase) * Math.sin(t * 2.1 + l.phase * 1.7) + 0.06 * Math.sin(t * 13 + l.phase);
      if (l.light) l.light.intensity = l.baseIntensity * f;
      l.glow.material.opacity = 0.3 + 0.15 * f;
    }
    cabinLight.intensity = 26 * (0.9 + 0.1 * Math.sin(t * 3.1) * Math.sin(t * 1.3));
    foamTex.offset.x -= dt * 0.12;
  };

  const dispose = () => {
    disposables.forEach((d) => d.dispose());
  };

  return { group, update, dispose };
}
