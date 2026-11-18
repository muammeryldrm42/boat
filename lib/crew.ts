import * as THREE from 'three';

// Procedural humanoid crew. Original characters, built from simple primitives and posed in code.
// Local convention: a figure faces +z, index 0 = the +x side limb, index 1 = the -x side limb.

export interface CrewContext {
  t: number;
  dt: number;
  rudder: number;
  speed: number;
  heel: number;
  sail: number;
  camDist?: number;
}

export type CrewRole =
  | 'captain' | 'helm' | 'lookout' | 'climber' | 'hauler' | 'leaner' | 'swabber' | 'watch' | 'talker' | 'mate'
  | 'yard' | 'sitter' | 'walker';

export interface HumanStyle {
  skin: number;
  shirt: number;
  pants: number;
  boots: number;
  hair: number;
  vest?: number;
  coat?: number;
  hat?: 'tricorn' | 'bandana' | 'cap' | 'none';
  hatColor?: number;
  beard?: boolean;
  scale?: number;
  rolled?: boolean;
  ponytail?: boolean;
  scarf?: number;
  sash?: number;
  plume?: boolean;
}

export interface CrewSpawn {
  role: CrewRole;
  style: HumanStyle;
  pos: [number, number, number];
  yaw?: number;
  phase?: number;
  // patrol / swab range along an axis
  range?: { axis: 'x' | 'z'; min: number; max: number };
  // climber line: feet travel from a to b, facing inward (side = +1 / -1 along x)
  line?: { a: [number, number, number]; b: [number, number, number]; side: number };
  // second person a talker faces
  partner?: number;
}

export interface Crew {
  group: THREE.Group;
  update: (ctx: CrewContext) => void;
  dispose: () => void;
}

interface Rig {
  root: THREE.Group;
  pelvis: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  sh: [THREE.Group, THREE.Group];
  el: [THREE.Group, THREE.Group];
  hand: [THREE.Group, THREE.Group];
  hip: [THREE.Group, THREE.Group];
  kn: [THREE.Group, THREE.Group];
  skirt: THREE.Mesh | null;
  fine: THREE.Group[];
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export function createCrew(spawns: CrewSpawn[]): Crew {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (c: number, rough = 0.85, metal = 0) => {
    const key = `${c}-${rough}-${metal}`;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, side: THREE.DoubleSide });
      matCache.set(key, m);
      disposables.push(m);
    }
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T) => {
    disposables.push(g);
    return g;
  };

  const gTorso = geo(new THREE.CapsuleGeometry(0.15, 0.34, 4, 10));
  const gUpper = geo(new THREE.CylinderGeometry(0.048, 0.04, 0.3, 8).translate(0, -0.15, 0));
  const gFore = geo(new THREE.CylinderGeometry(0.04, 0.034, 0.27, 8).translate(0, -0.135, 0));
  const gHand = geo(new THREE.SphereGeometry(0.05, 8, 8));
  const gThigh = geo(new THREE.CylinderGeometry(0.075, 0.058, 0.45, 8).translate(0, -0.225, 0));
  const gShin = geo(new THREE.CylinderGeometry(0.056, 0.045, 0.45, 8).translate(0, -0.225, 0));
  const gBoot = geo(new THREE.BoxGeometry(0.1, 0.09, 0.27).translate(0, -0.045, 0.06));
  const gCuff = geo(new THREE.CylinderGeometry(0.064, 0.058, 0.2, 8).translate(0, -0.33, 0));
  const gHead = geo(new THREE.SphereGeometry(0.115, 14, 12));
  const gNeck = geo(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 8));
  const gEye = geo(new THREE.SphereGeometry(0.013, 6, 6));
  const gNose = geo(new THREE.SphereGeometry(0.026, 6, 6));
  const gHair = geo(new THREE.SphereGeometry(0.123, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6));
  const gBeard = geo(new THREE.SphereGeometry(0.075, 8, 8));
  const gPelvis = geo(new THREE.BoxGeometry(0.3, 0.17, 0.2));
  const gBelt = geo(new THREE.CylinderGeometry(0.168, 0.17, 0.05, 12));
  const gSkirt = geo(new THREE.CylinderGeometry(0.19, 0.3, 0.62, 12, 1, true).translate(0, -0.3, 0));
  const gButton = geo(new THREE.SphereGeometry(0.011, 5, 5));
  const gCrown = geo(new THREE.CylinderGeometry(0.115, 0.125, 0.1, 12));
  const gBandana = geo(new THREE.TorusGeometry(0.118, 0.016, 6, 14));
  const gScabbard = geo(new THREE.CylinderGeometry(0.018, 0.016, 0.85, 6));
  const gHilt = geo(new THREE.BoxGeometry(0.12, 0.025, 0.025));
  const gMopPole = geo(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 6));
  const gMopHead = geo(new THREE.ConeGeometry(0.1, 0.22, 8));
  const brimShape = new THREE.Shape();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const r = 0.27;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) brimShape.moveTo(x, y);
    else brimShape.lineTo(x, y);
  }
  brimShape.closePath();
  const gBrim = geo(new THREE.ExtrudeGeometry(brimShape, { depth: 0.014, bevelEnabled: false }).rotateX(-Math.PI / 2));

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = shadow;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };

  // woven-cloth bump so clothes read as fabric up close
  const clothBump = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        const v = 110 + ((x + y) % 4 === 0 ? 40 : 0) + Math.random() * 30;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, y, 2, 2);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    disposables.push(t);
    return t;
  })();
  const cloth = (c: number) => {
    const key = `cloth-${c}`;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, bumpMap: clothBump, bumpScale: 0.8, side: THREE.DoubleSide });
      matCache.set(key, m);
      disposables.push(m);
    }
    return m;
  };
  const gChest = geo(new THREE.CapsuleGeometry(0.15, 0.2, 6, 14));
  const gWaist = geo(new THREE.CapsuleGeometry(0.13, 0.1, 6, 14));
  const gShoulder = geo(new THREE.SphereGeometry(0.062, 10, 8));
  const gEar = geo(new THREE.SphereGeometry(0.026, 8, 6));
  const gSclera = geo(new THREE.SphereGeometry(0.0165, 8, 8));
  const gPupil = geo(new THREE.SphereGeometry(0.0095, 6, 6));
  const gBrow = geo(new THREE.BoxGeometry(0.036, 0.008, 0.01));
  const gMouth = geo(new THREE.BoxGeometry(0.034, 0.006, 0.008));
  const gStache = geo(new THREE.BoxGeometry(0.06, 0.014, 0.014));
  const gNoseCone = geo(new THREE.ConeGeometry(0.02, 0.04, 6).rotateX(Math.PI / 2));
  const gPalm = geo(new THREE.BoxGeometry(0.062, 0.085, 0.03).translate(0, -0.04, 0));
  const gFingers = geo(new THREE.BoxGeometry(0.058, 0.04, 0.026).translate(0, -0.1, 0.006));
  const gThumb = geo(new THREE.CapsuleGeometry(0.012, 0.035, 3, 6).translate(0, -0.05, 0));
  const gCuffRing = geo(new THREE.CylinderGeometry(0.043, 0.043, 0.03, 8).translate(0, -0.255, 0));
  const gTail = geo(new THREE.BoxGeometry(0.15, 0.5, 0.02).translate(0, -0.25, 0));
  const gLapel = geo(new THREE.BoxGeometry(0.05, 0.3, 0.012));
  const gEpaulette = geo(new THREE.BoxGeometry(0.09, 0.014, 0.07));
  const gScarf = geo(new THREE.TorusGeometry(0.068, 0.02, 6, 12));
  const gPlume = geo(new THREE.CylinderGeometry(0.004, 0.02, 0.26, 5).translate(0, 0.13, 0));
  const gPonytail = geo(new THREE.CapsuleGeometry(0.03, 0.14, 4, 8));
  const gPouch = geo(new THREE.BoxGeometry(0.07, 0.09, 0.04));
  const gTurn = geo(new THREE.CylinderGeometry(0.07, 0.062, 0.07, 10).translate(0, -0.24, 0));

  const makeHuman = (st: HumanStyle): Rig => {
    const root = new THREE.Group();
    root.scale.setScalar(st.scale ?? 1);
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.95;
    root.add(pelvis);
    const finePelvis = new THREE.Group();
    pelvis.add(finePelvis);
    const pantsM = cloth(st.pants);
    const skinM = mat(st.skin, 0.62);
    const torsoColor = st.coat ?? st.vest ?? st.shirt;
    const torsoM = cloth(torsoColor);
    mesh(gPelvis, pantsM, pelvis);
    const spine = new THREE.Group();
    spine.position.y = 0.05;
    pelvis.add(spine);
    const fineSpine = new THREE.Group();
    spine.add(fineSpine);
    const waist = mesh(gWaist, torsoM, spine, 0, 0.1, 0);
    waist.scale.set(1.12, 1, 0.82);
    const chest = mesh(gChest, torsoM, spine, 0, 0.37, 0);
    chest.scale.set(1.22, 1, 0.85);
    mesh(gBelt, mat(0x2a1d12, 0.6), pelvis, 0, 0.1, 0);
    mesh(geo(new THREE.BoxGeometry(0.035, 0.035, 0.012)), mat(0xb89a4a, 0.4, 0.8), finePelvis, 0, 0.1, 0.172, false);
    if (st.sash) {
      const sa = mesh(geo(new THREE.TorusGeometry(0.168, 0.03, 6, 14)), cloth(st.sash), pelvis, 0, 0.06, 0, false);
      sa.rotation.x = Math.PI / 2;
    }
    const pouch = mesh(gPouch, mat(0x3a2a1a, 0.7), pelvis, -0.17, 0.02, 0.05, false);
    pouch.rotation.z = 0.1;
    // neck, collar and shirt peeking out
    mesh(gNeck, skinM, spine, 0, 0.6, 0, false);
    const collar = mesh(geo(new THREE.TorusGeometry(0.066, 0.02, 6, 12)), cloth(st.shirt), spine, 0, 0.59, 0, false);
    collar.rotation.x = Math.PI / 2;
    if (!st.coat) {
      const v = mesh(geo(new THREE.CircleGeometry(0.048, 3)), skinM, spine, 0, 0.545, 0.128, false);
      v.rotation.z = Math.PI;
    }
    if (st.scarf) {
      const sc = mesh(gScarf, cloth(st.scarf), spine, 0, 0.575, 0.01, false);
      sc.rotation.x = Math.PI / 2;
      mesh(geo(new THREE.SphereGeometry(0.03, 6, 6)), cloth(st.scarf), spine, 0.03, 0.54, 0.085, false);
    }
    const head = new THREE.Group();
    head.position.set(0, 0.66, 0);
    spine.add(head);
    const fineHead = new THREE.Group();
    head.add(fineHead);
    const skull = mesh(gHead, skinM, head, 0, 0.1, 0);
    skull.scale.set(1, 1.13, 1.05);
    mesh(gNoseCone, skinM, head, 0, 0.088, 0.125, false);
    mesh(gEar, skinM, head, 0.112, 0.1, -0.005, false).scale.set(0.5, 1.2, 0.8);
    mesh(gEar, skinM, head, -0.112, 0.1, -0.005, false).scale.set(0.5, 1.2, 0.8);
    const sclera = mat(0xeeeadf, 0.4);
    const pupil = mat(0x120d0a, 0.3);
    for (const sx of [1, -1]) {
      mesh(gSclera, sclera, fineHead, sx * 0.042, 0.125, 0.103, false);
      mesh(gPupil, pupil, fineHead, sx * 0.042, 0.125, 0.116, false);
      mesh(gBrow, mat(st.hair, 0.9), fineHead, sx * 0.042, 0.155, 0.108, false);
    }
    mesh(gMouth, mat(0x6a2f2a, 0.6), fineHead, 0, 0.045, 0.108, false);
    if (st.hat !== 'cap' && st.hat !== 'bandana' && st.hat !== 'tricorn') {
      const h = mesh(gHair, mat(st.hair, 0.9), head, 0, 0.112, -0.005);
      h.scale.set(1, 1, 1.02);
    }
    if (st.hat === 'cap') {
      const h = mesh(gHair, cloth(st.hatColor ?? 0x2a3a4a), head, 0, 0.118, -0.004);
      h.scale.set(1.04, 1.05, 1.06);
    }
    if (st.hat === 'bandana') {
      const h = mesh(gHair, mat(st.hair, 0.9), head, 0, 0.112, -0.005);
      h.scale.set(1, 1, 1.02);
      const b = mesh(gBandana, cloth(st.hatColor ?? 0x8a2a24), head, 0, 0.16, 0);
      b.rotation.x = Math.PI / 2 - 0.12;
      mesh(geo(new THREE.SphereGeometry(0.03, 6, 6)), cloth(st.hatColor ?? 0x8a2a24), head, 0.06, 0.15, -0.1, false);
    }
    if (st.hat === 'tricorn') {
      mesh(gHair, mat(st.hair, 0.9), head, 0, 0.1, -0.02).scale.set(1, 0.9, 1.05);
      const hc = st.hatColor ?? 0x1a1612;
      mesh(gCrown, cloth(hc), head, 0, 0.255, 0);
      const brim = mesh(gBrim, cloth(hc), head, 0, 0.205, 0);
      brim.rotation.y = Math.PI;
      mesh(geo(new THREE.TorusGeometry(0.1, 0.01, 4, 12)), mat(0xb89a4a, 0.4, 0.8), head, 0, 0.3, 0, false).rotation.x = Math.PI / 2;
      if (st.plume) {
        const pl = mesh(gPlume, mat(0xe8e2d2, 0.9), head, -0.1, 0.27, -0.05, false);
        pl.rotation.set(-0.5, 0, 0.9);
      }
    }
    if (st.ponytail || st.hat === 'tricorn') {
      const pt = mesh(gPonytail, mat(st.hair, 0.9), head, 0, 0.03, -0.14, false);
      pt.rotation.x = 0.45;
      mesh(geo(new THREE.TorusGeometry(0.03, 0.007, 4, 8)), mat(0x111111, 0.6), head, 0, 0.1, -0.12, false);
    }
    if (st.beard) {
      const b = mesh(gBeard, mat(st.hair, 0.95), head, 0, 0.012, 0.072);
      b.scale.set(1.02, 1.1, 0.72);
      mesh(gStache, mat(st.hair, 0.95), fineHead, 0, 0.062, 0.112, false);
    }
    const sleeveM = cloth(st.coat ?? st.shirt);
    const forearmM = st.rolled ? skinM : sleeveM;
    const sh: THREE.Group[] = [];
    const el: THREE.Group[] = [];
    const hand: THREE.Group[] = [];
    const hip: THREE.Group[] = [];
    const kn: THREE.Group[] = [];
    for (const s of [1, -1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.2, 0.5, 0);
      spine.add(shoulder);
      mesh(gShoulder, sleeveM, shoulder, 0, 0, 0, false);
      if (st.coat) mesh(gEpaulette, mat(0xc9a74a, 0.35, 0.85), shoulder, 0, 0.055, 0, false);
      mesh(gUpper, sleeveM, shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      mesh(gFore, forearmM, elbow);
      if (st.coat) mesh(gCuffRing, mat(0xc9a74a, 0.35, 0.85), elbow, 0, 0, 0, false);
      else if (!st.rolled) mesh(gCuffRing, cloth(st.shirt), elbow, 0, 0, 0, false);
      const h = new THREE.Group();
      h.position.y = -0.29;
      elbow.add(h);
      mesh(gPalm, skinM, h, 0, 0, 0, false);
      mesh(gFingers, skinM, h, 0, 0, 0, false);
      const th = mesh(gThumb, skinM, h, s * -0.035, 0, 0.012, false);
      th.rotation.z = s * 0.4;
      sh.push(shoulder);
      el.push(elbow);
      hand.push(h);
      const hp = new THREE.Group();
      hp.position.set(s * 0.1, -0.03, 0);
      pelvis.add(hp);
      mesh(gThigh, pantsM, hp);
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      hp.add(knee);
      mesh(gShin, pantsM, knee);
      mesh(gCuff, mat(st.boots, 0.55), knee);
      mesh(gTurn, mat(st.boots, 0.55), knee, 0, 0, 0, false);
      const foot = mesh(gBoot, mat(st.boots, 0.55), knee, 0, -0.45, 0);
      foot.castShadow = false;
      hip.push(hp);
      kn.push(knee);
    }
    let skirt: THREE.Mesh | null = null;
    if (st.coat) {
      skirt = mesh(gSkirt, cloth(st.coat), pelvis, 0, 0.08, 0);
      const trim = new THREE.Color(st.coat).multiplyScalar(1.7).getHex();
      for (const sx of [1, -1]) {
        const lp = mesh(gLapel, mat(trim, 0.7), spine, sx * 0.055, 0.34, 0.13, false);
        lp.rotation.z = sx * -0.12;
      }
      for (let i = 0; i < 6; i++) mesh(gButton, mat(0xc9a74a, 0.35, 0.85), fineSpine, 0, 0.04 + i * 0.09, 0.128, false);
      const tail = mesh(gTail, cloth(st.coat), pelvis, 0, -0.04, -0.13, false);
      tail.rotation.x = 0.08;
      const cr = mesh(geo(new THREE.SphereGeometry(0.04, 8, 6)), mat(0xf0ebdc, 0.8), spine, 0, 0.56, 0.1, false);
      cr.scale.set(1.2, 1, 0.8);
      const sw = new THREE.Group();
      sw.position.set(0.19, 0.05, -0.02);
      sw.rotation.set(0.12, 0, 0.1);
      pelvis.add(sw);
      mesh(gScabbard, mat(0x201813, 0.5), sw, 0, -0.42, 0, false);
      mesh(gHilt, mat(0xb89a4a, 0.35, 0.85), sw, 0, 0.02, 0, false);
    } else {
      mesh(geo(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5)), mat(0x4a3a2a, 0.7), pelvis, 0.17, -0.05, 0.06, false).rotation.z = 0.15;
    }
    return {
      root, pelvis, spine, head, fine: [fineHead, fineSpine, finePelvis],
      sh: [sh[0], sh[1]], el: [el[0], el[1]], hand: [hand[0], hand[1]],
      hip: [hip[0], hip[1]], kn: [kn[0], kn[1]], skirt,
    };
  };

  const reset = (r: Rig) => {
    r.pelvis.rotation.set(0, 0, 0);
    r.pelvis.position.y = 0.95;
    r.spine.rotation.set(0, 0, 0);
    r.head.rotation.set(0, 0, 0);
    for (let i = 0; i < 2; i++) {
      r.sh[i].rotation.set(0, 0, (i === 0 ? 1 : -1) * 0.07);
      r.el[i].rotation.set(-0.18, 0, 0);
      r.hip[i].rotation.set(0, 0, 0);
      r.kn[i].rotation.set(0, 0, 0);
    }
    if (r.skirt) r.skirt.rotation.set(0, 0, 0);
  };
  const breathe = (r: Rig, t: number, ph: number) => {
    r.spine.rotation.x += Math.sin(t * 1.5 + ph) * 0.008;
    r.spine.scale.y = 1 + Math.sin(t * 1.5 + ph) * 0.006;
  };
  const walk = (r: Rig, ph: number, amp: number) => {
    for (let i = 0; i < 2; i++) {
      const f = ph + (i === 0 ? 0 : Math.PI);
      r.hip[i].rotation.x = -Math.sin(f) * amp;
      r.kn[i].rotation.x = Math.max(0, Math.cos(f)) * amp * 1.4;
      r.sh[i].rotation.x = Math.sin(f) * amp * 0.85;
    }
    r.pelvis.position.y = 0.95 - Math.abs(Math.cos(ph)) * 0.025;
    r.pelvis.rotation.y = Math.sin(ph) * 0.08;
  };
  const planted = (r: Rig, heel: number) => {
    r.pelvis.rotation.z = -heel * 0.45;
    r.spine.rotation.z = heel * 0.2;
  };

  type Updater = (c: CrewContext) => void;
  const updaters: Updater[] = [];
  const rigs: Rig[] = [];

  spawns.forEach((sp, index) => {
    const rig = makeHuman(sp.style);
    rig.root.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    rig.root.rotation.y = sp.yaw ?? 0;
    group.add(rig.root);
    rigs.push(rig);
    const ph0 = sp.phase ?? index * 1.7;
    const base = new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]);

    switch (sp.role) {
      case 'captain': {
        const rg = sp.range ?? { axis: 'x' as const, min: -3.2, max: 3.2 };
        let dir = 1;
        let state: 'walk' | 'pause' = 'pause';
        let timer = 2 + ph0;
        let cur = base.x;
        let wph = 0;
        let targetYaw = rig.root.rotation.y;
        updaters.push((c) => {
          reset(rig);
          timer -= c.dt;
          if (state === 'pause' && timer <= 0) {
            state = 'walk';
            timer = 7 + Math.random() * 4;
          } else if (state === 'walk') {
            cur += dir * 0.85 * c.dt;
            wph += c.dt * 3.3;
            if (cur > rg.max || cur < rg.min || timer <= 0) {
              cur = clamp(cur, rg.min, rg.max);
              state = 'pause';
              timer = 4 + Math.random() * 5;
              if (cur >= rg.max - 0.05) dir = -1;
              else if (cur <= rg.min + 0.05) dir = 1;
              else dir = Math.random() > 0.5 ? 1 : -1;
            }
          }
          targetYaw = state === 'walk' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : 0.12;
          rig.root.rotation.y = lerpAngle(rig.root.rotation.y, targetYaw, 1 - Math.exp(-c.dt * 3));
          rig.root.position.x = cur;
          if (state === 'walk') walk(rig, wph, 0.5);
          // left hand rests on the sword hilt (+x hip), right hand behind the back
          rig.sh[0].rotation.set(-0.25, 0, 0.2);
          rig.el[0].rotation.set(-1.15, 0, 0);
          rig.sh[1].rotation.set(0.5, 0, -0.1);
          rig.el[1].rotation.set(-1.0, 0, 0.4);
          if (state === 'pause') {
            rig.head.rotation.y = Math.sin(c.t * 0.25 + ph0) * 0.7;
            rig.head.rotation.x = -0.12 + Math.sin(c.t * 0.17) * 0.1;
          }
          if (rig.skirt) rig.skirt.rotation.x = 0.05 + Math.sin(c.t * 1.4 + ph0) * 0.04 + (state === 'walk' ? 0.1 : 0);
          rig.spine.rotation.x = -0.04;
          planted(rig, c.heel);
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'helm': {
        updaters.push((c) => {
          reset(rig);
          rig.hip[0].rotation.set(-0.05, 0, 0.1);
          rig.hip[1].rotation.set(0.05, 0, -0.1);
          rig.kn[0].rotation.x = 0.1 + Math.abs(c.heel) * 0.6;
          rig.kn[1].rotation.x = 0.1;
          rig.spine.rotation.x = 0.1;
          rig.spine.rotation.y = c.rudder * 0.32;
          rig.sh[0].rotation.set(-1.25, 0, 0.18);
          rig.sh[1].rotation.set(-1.25, 0, -0.18);
          rig.el[0].rotation.set(-0.35 - c.rudder * 0.15, 0, 0);
          rig.el[1].rotation.set(-0.35 + c.rudder * 0.15, 0, 0);
          rig.head.rotation.y = Math.sin(c.t * 0.3 + ph0) * 0.25 - c.rudder * 0.2;
          rig.head.rotation.x = -0.18;
          planted(rig, c.heel);
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'lookout': {
        updaters.push((c) => {
          reset(rig);
          rig.hip[0].rotation.z = 0.12;
          rig.hip[1].rotation.z = -0.12;
          rig.sh[0].rotation.set(-1.55, 0, 0.1);
          rig.el[0].rotation.set(-1.9, 0, 0);
          rig.sh[1].rotation.set(-0.5, 0, -0.35);
          rig.el[1].rotation.set(-0.6, 0, 0);
          rig.head.rotation.y = Math.sin(c.t * 0.35 + ph0) * 0.95;
          rig.head.rotation.x = -0.06;
          rig.spine.rotation.y = Math.sin(c.t * 0.35 + ph0) * 0.25;
          rig.spine.rotation.z = c.heel * 1.3;
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'climber': {
        const ln = sp.line!;
        const a = new THREE.Vector3(...ln.a);
        const b = new THREE.Vector3(...ln.b);
        let f = 0.05;
        let climbPh = 0;
        rig.root.rotation.y = ln.side > 0 ? -Math.PI / 2 : Math.PI / 2;
        const period = 58;
        updaters.push((c) => {
          reset(rig);
          const tt = ((c.t + ph0 * 5) % period) / period;
          let moving = 0;
          let target = 0.06;
          if (tt < 0.38) {
            target = 0.06 + 0.72 * (tt / 0.38);
            moving = 1;
          } else if (tt < 0.5) {
            target = 0.78;
          } else if (tt < 0.88) {
            target = 0.78 - 0.72 * ((tt - 0.5) / 0.38);
            moving = -1;
          }
          f += (target - f) * Math.min(1, c.dt * 4);
          climbPh += moving * c.dt * 3.4;
          const p = a.clone().lerp(b, f);
          rig.root.position.set(p.x - ln.side * 0.2, p.y, p.z);
          if (moving !== 0) {
            const ph = climbPh;
            rig.hip[0].rotation.x = -0.15 - Math.max(0, Math.sin(ph)) * 0.9;
            rig.kn[0].rotation.x = Math.max(0, Math.sin(ph)) * 1.2;
            rig.hip[1].rotation.x = -0.15 - Math.max(0, -Math.sin(ph)) * 0.9;
            rig.kn[1].rotation.x = Math.max(0, -Math.sin(ph)) * 1.2;
            rig.sh[0].rotation.set(-2.5 + Math.max(0, -Math.sin(ph)) * 0.5, 0, 0.1);
            rig.sh[1].rotation.set(-2.5 + Math.max(0, Math.sin(ph)) * 0.5, 0, -0.1);
            rig.el[0].rotation.x = -0.5;
            rig.el[1].rotation.x = -0.5;
            rig.spine.rotation.x = -0.08;
          } else {
            rig.sh[0].rotation.set(-2.4, 0, 0.1);
            rig.sh[1].rotation.set(-2.2, 0, -0.1);
            rig.el[0].rotation.x = -0.4;
            rig.el[1].rotation.x = -0.4;
            rig.head.rotation.y = Math.sin(c.t * 0.5 + ph0) * 0.6;
          }
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'hauler': {
        updaters.push((c) => {
          reset(rig);
          const active = Math.sin(c.t * 0.12 + ph0 * 0.4) > -0.25;
          if (active) {
            const ph = c.t * 2.2 + ph0 * 0.3;
            const s = Math.sin(ph);
            rig.sh[0].rotation.set(-0.9 + s * 0.85, 0, 0.15);
            rig.sh[1].rotation.set(-0.9 - s * 0.85, 0, -0.15);
            rig.el[0].rotation.x = -0.9 - Math.max(0, s) * 0.7;
            rig.el[1].rotation.x = -0.9 - Math.max(0, -s) * 0.7;
            rig.spine.rotation.x = 0.2 - s * 0.22;
            rig.hip[0].rotation.set(-0.35, 0, 0.1);
            rig.hip[1].rotation.set(0.25, 0, -0.1);
            rig.kn[0].rotation.x = 0.45;
            rig.kn[1].rotation.x = 0.3;
            rig.head.rotation.x = -0.15;
          } else {
            rig.sh[0].rotation.set(-0.1, 0, 0.45);
            rig.sh[1].rotation.set(-0.1, 0, -0.45);
            rig.el[0].rotation.x = -1.2;
            rig.el[1].rotation.x = -1.2;
            rig.head.rotation.y = Math.sin(c.t * 0.3 + ph0) * 0.6;
          }
          planted(rig, c.heel);
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'leaner': {
        updaters.push((c) => {
          reset(rig);
          rig.spine.rotation.x = 0.38;
          rig.sh[0].rotation.set(-0.95, 0, 0.12);
          rig.sh[1].rotation.set(-0.95, 0, -0.12);
          rig.el[0].rotation.x = -1.35;
          rig.el[1].rotation.x = -1.35;
          rig.hip[0].rotation.set(-0.08, 0, 0.05);
          rig.hip[1].rotation.set(0.12, 0, -0.05);
          rig.head.rotation.x = -0.35;
          rig.head.rotation.y = Math.sin(c.t * 0.22 + ph0) * 0.7;
          planted(rig, c.heel);
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'swabber': {
        const rg = sp.range ?? { axis: 'z' as const, min: -6.5, max: -1.2 };
        let dir = 1;
        let cur = rg.axis === 'z' ? base.z : base.x;
        const mop = new THREE.Group();
        mesh(gMopPole, mat(0x4a3a2a, 0.8), mop, 0, 0, 0, false);
        mesh(gMopHead, mat(0x8a826c, 0.95), mop, 0, -0.72, 0, false).rotation.x = Math.PI;
        rig.hand[0].add(mop);
        mop.position.set(0, 0, 0.02);
        mop.rotation.x = -0.7;
        let wph = 0;
        updaters.push((c) => {
          reset(rig);
          cur += dir * 0.22 * c.dt;
          if (cur > rg.max) dir = -1;
          if (cur < rg.min) dir = 1;
          if (rg.axis === 'z') rig.root.position.z = cur;
          else rig.root.position.x = cur;
          const faceYaw = rg.axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
          rig.root.rotation.y = lerpAngle(rig.root.rotation.y, faceYaw, 1 - Math.exp(-c.dt * 2));
          wph += c.dt * 1.6;
          const s = Math.sin(wph);
          rig.spine.rotation.x = 0.42;
          rig.spine.rotation.y = s * 0.5;
          rig.sh[0].rotation.set(-0.9, 0, 0.15);
          rig.sh[1].rotation.set(-0.7, 0, -0.1);
          rig.el[0].rotation.x = -0.5;
          rig.el[1].rotation.x = -0.6;
          mop.rotation.z = s * 0.35;
          rig.hip[0].rotation.x = -0.15 + Math.max(0, s) * 0.3;
          rig.hip[1].rotation.x = 0.1 - Math.max(0, -s) * 0.3;
          rig.kn[0].rotation.x = 0.2;
          rig.kn[1].rotation.x = 0.15;
          rig.head.rotation.x = -0.3;
          planted(rig, c.heel);
        });
        break;
      }
      case 'watch': {
        updaters.push((c) => {
          reset(rig);
          rig.sh[0].rotation.set(-2.6, 0, 0.3);
          rig.el[0].rotation.x = -0.3;
          rig.sh[1].rotation.set(-0.15, 0, -0.35);
          rig.el[1].rotation.x = -1.3;
          rig.hip[0].rotation.set(-0.1, 0, 0.12);
          rig.hip[1].rotation.set(0.1, 0, -0.12);
          rig.head.rotation.y = Math.sin(c.t * 0.28 + ph0) * 0.55;
          rig.head.rotation.x = -0.1;
          rig.spine.rotation.z = c.heel * 0.4;
          planted(rig, c.heel * 0.5);
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'talker': {
        const speaks = (sp.partner ?? 0) === 0;
        updaters.push((c) => {
          reset(rig);
          const burst = Math.max(0, Math.sin(c.t * 0.5 + ph0 * 2));
          if (speaks) {
            rig.sh[0].rotation.set(-0.8 - burst * 0.5, 0, 0.35 + burst * 0.2);
            rig.el[0].rotation.x = -1.0 - Math.sin(c.t * 3 + ph0) * 0.4 * burst;
            rig.sh[1].rotation.set(-0.15, 0, -0.2);
            rig.el[1].rotation.x = -1.4;
            rig.head.rotation.y = 0.15 + Math.sin(c.t * 0.9) * 0.1;
            rig.head.rotation.x = Math.sin(c.t * 4 + ph0) * 0.05 * burst;
          } else {
            rig.sh[0].rotation.set(-0.1, 0, 0.35);
            rig.el[0].rotation.x = -1.3;
            rig.sh[1].rotation.set(0.2, 0, -0.2);
            rig.el[1].rotation.x = -0.6;
            rig.head.rotation.x = Math.max(0, Math.sin(c.t * 0.6 + ph0)) * 0.18 - 0.03;
            rig.head.rotation.y = -0.15;
          }
          rig.hip[0].rotation.set(-0.12, 0, 0.1);
          rig.hip[1].rotation.set(0.1, 0, -0.08);
          planted(rig, c.heel);
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'yard': {
        updaters.push((c) => {
          reset(rig);
          const work = Math.sin(c.t * 0.35 + ph0 * 1.3);
          rig.spine.rotation.x = 0.5 + work * 0.07;
          rig.hip[0].rotation.set(-0.1, 0, 0.14);
          rig.hip[1].rotation.set(-0.1, 0, -0.14);
          rig.kn[0].rotation.x = 0.2;
          rig.kn[1].rotation.x = 0.2;
          rig.sh[0].rotation.set(-1.15 + work * 0.35, 0, 0.1);
          rig.sh[1].rotation.set(-1.05 - work * 0.3, 0, -0.1);
          rig.el[0].rotation.x = -0.45;
          rig.el[1].rotation.x = -0.55;
          rig.head.rotation.x = -0.4;
          rig.head.rotation.y = Math.sin(c.t * 0.3 + ph0) * 0.5;
          rig.pelvis.rotation.z = -c.heel * 0.5;
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'sitter': {
        updaters.push((c) => {
          reset(rig);
          rig.pelvis.position.y = 0.4;
          rig.hip[0].rotation.set(-1.5, 0, 0.12);
          rig.hip[1].rotation.set(-1.5, 0, -0.12);
          rig.kn[0].rotation.x = 1.5;
          rig.kn[1].rotation.x = 1.5;
          rig.spine.rotation.x = 0.28;
          const m = Math.sin(c.t * 2.4 + ph0);
          rig.sh[0].rotation.set(-0.8 + m * 0.2, 0, 0.12);
          rig.sh[1].rotation.set(-0.8 - m * 0.2, 0, -0.12);
          rig.el[0].rotation.x = -1.3 - Math.max(0, m) * 0.3;
          rig.el[1].rotation.x = -1.3 - Math.max(0, -m) * 0.3;
          rig.head.rotation.x = -0.4 + Math.sin(c.t * 0.5) * 0.05;
          rig.head.rotation.y = Math.sin(c.t * 0.25 + ph0) * 0.3;
          rig.pelvis.rotation.z = -c.heel * 0.3;
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'walker': {
        const rg = sp.range ?? { axis: 'z' as const, min: 1.5, max: 10.5 };
        let dir = 1;
        let cur = rg.axis === 'z' ? base.z : base.x;
        let wph = ph0;
        let pause = 0;
        updaters.push((c) => {
          reset(rig);
          if (pause > 0) {
            pause -= c.dt;
            rig.head.rotation.y = Math.sin(c.t * 0.4 + ph0) * 0.7;
            rig.sh[0].rotation.set(-0.1, 0, 0.45);
            rig.el[0].rotation.x = -1.2;
            rig.sh[1].rotation.set(-0.1, 0, -0.45);
            rig.el[1].rotation.x = -1.2;
            planted(rig, c.heel);
            breathe(rig, c.t, ph0);
            return;
          }
          cur += dir * 0.95 * c.dt;
          wph += c.dt * 3.5;
          if (cur > rg.max || cur < rg.min) {
            cur = clamp(cur, rg.min, rg.max);
            dir = -dir;
            pause = 3 + Math.random() * 4;
          }
          if (rg.axis === 'z') rig.root.position.z = cur;
          else rig.root.position.x = cur;
          const targetYaw = rg.axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
          rig.root.rotation.y = lerpAngle(rig.root.rotation.y, targetYaw, 1 - Math.exp(-c.dt * 3));
          walk(rig, wph, 0.5);
          rig.pelvis.rotation.z = -c.heel * 0.4;
          breathe(rig, c.t, ph0);
        });
        break;
      }
      case 'mate': {
        updaters.push((c) => {
          reset(rig);
          rig.sh[0].rotation.set(0.5, 0, -0.1);
          rig.el[0].rotation.set(-1.0, 0, -0.4);
          rig.sh[1].rotation.set(0.5, 0, 0.1);
          rig.el[1].rotation.set(-1.0, 0, 0.4);
          rig.hip[0].rotation.set(-0.08, 0, 0.12);
          rig.hip[1].rotation.set(0.06, 0, -0.12);
          rig.spine.rotation.x = -0.05;
          rig.head.rotation.y = Math.sin(c.t * 0.18 + ph0) * 0.8;
          rig.head.rotation.x = -0.3 + Math.sin(c.t * 0.11) * 0.12;
          if (rig.skirt) rig.skirt.rotation.x = 0.05 + Math.sin(c.t * 1.2 + ph0) * 0.04;
          planted(rig, c.heel);
          breathe(rig, c.t, ph0);
        });
        break;
      }
    }
  });

  const update = (c: CrewContext) => {
    const near = (c.camDist ?? 0) < 48;
    for (const r of rigs) for (const f of r.fine) f.visible = near;
    for (const u of updaters) u(c);
  };
  const dispose = () => disposables.forEach((d) => d.dispose());
  return { group, update, dispose };
}
