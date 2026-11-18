'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VESSELS } from '@/lib/vessels';
import { createCrew } from '@/lib/crew';
import { Sailing, pointOfSail } from '@/lib/sailing';
import { controlInput } from '@/lib/input';
import { WAVE_UNIFORMS, waveHeight } from '@/lib/waves';
import {
  SKY_VERT, SKY_FRAG, OCEAN_VERT, OCEAN_FRAG, RAIN_VERT, RAIN_FRAG, FINISH_SHADER,
} from '@/lib/shaders';
import { makeMistTexture } from '@/lib/textures';

const MOON_DIR = new THREE.Vector3(-0.78, 0.33, 0.52).normalize();

function buildOceanGeometry(rMin: number, rMax: number, rings: number, sectors: number) {
  const pos = new Float32Array((rings + 1) * (sectors + 1) * 3);
  const idx: number[] = [];
  let k = 0;
  for (let i = 0; i <= rings; i++) {
    const r = rMin * Math.pow(rMax / rMin, i / rings);
    for (let j = 0; j <= sectors; j++) {
      const a = (j / sectors) * Math.PI * 2;
      pos[k++] = Math.cos(a) * r;
      pos[k++] = 0;
      pos[k++] = Math.sin(a) * r;
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * (sectors + 1) + j;
      const b = a + sectors + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const ISLANDS: [number, number, number][] = [
  [220, 520, 70], [-380, 330, 95], [-120, -640, 120], [560, -180, 85], [-560, -420, 110], [90, 900, 150],
];

// Low, dark island silhouettes far out so there is something to sail past.
function buildIslands(): THREE.Group {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b1210, roughness: 1, flatShading: true });
  const rnd = (s: number) => {
    const x = Math.sin(s * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  ISLANDS.forEach(([x, z, r], i) => {
    const g = new THREE.ConeGeometry(r, r * 0.55, 24, 8, false);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) {
      const vx = p.getX(v);
      const vz = p.getZ(v);
      const n = rnd(Math.round(vx * 0.17) + Math.round(vz * 0.23) * 31 + i * 7);
      p.setY(v, p.getY(v) * (0.75 + n * 0.5));
      p.setX(v, vx * (0.9 + n * 0.2));
      p.setZ(v, vz * (0.9 + rnd(v + i) * 0.2));
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, r * 0.14, z);
    grp.add(m);
  });
  return grp;
}

export default function Scene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const qs = new URLSearchParams(window.location.search);
    const storm = qs.get('storm') === '1';
    const vessel = VESSELS[0];

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const fogDensity = storm ? 0.0042 : 0.0016;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(new THREE.Color(0.05, 0.082, 0.1), fogDensity);

    const camera = new THREE.PerspectiveCamera(48, mount.clientWidth / mount.clientHeight, 0.3, 4000);
    camera.position.copy(vessel.camera.offset);
    const camQ = qs.get('cam');
    if (camQ) {
      const c = camQ.split(',').map(Number);
      if (c.length === 3 && c.every((n) => Number.isFinite(n))) camera.position.set(c[0], c[1], c[2]);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, vessel.camera.targetY, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = vessel.camera.minDistance;
    controls.maxDistance = vessel.camera.maxDistance;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.enablePan = false;

    // ---- shared uniforms ----
    const uFlash = { value: 0 };
    const uMoonDir = { value: MOON_DIR.clone() };
    const uTime = { value: 0 };
    const uCam = { value: new THREE.Vector3() };
    const uCenter = { value: new THREE.Vector2() };
    const uCover = { value: storm ? 1.0 : 0.3 };
    const seaAmp = storm ? 1.3 : 0.85;

    // ---- sky ----
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime, uFlash, uMoonDir, uCover },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 32), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    // image based lighting from the procedural sky so wood, iron and cloth pick up real reflections
    {
      const envScene = new THREE.Scene();
      const envSky = new THREE.Mesh(sky.geometry, skyMat);
      envSky.frustumCulled = false;
      envScene.add(envSky);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envRT = pmrem.fromScene(envScene, 0, 1, 3000);
      scene.environment = envRT.texture;
      scene.environmentIntensity = storm ? 0.5 : 0.8;
      pmrem.dispose();
    }

    // ---- ocean ----
    const oceanMat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: {
        uTime, uCam, uFlash, uMoonDir, uCenter,
        uWaves: { value: WAVE_UNIFORMS },
        uAmp: { value: seaAmp },
        uFogDensity: { value: fogDensity },
      },
    });
    const oceanGeo = buildOceanGeometry(0.6, 2200, 240, 420);
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.frustumCulled = false;
    scene.add(ocean);

    const islands = buildIslands();
    scene.add(islands);

    // ---- lights ----
    const moon = new THREE.DirectionalLight(0xb4c8f0, storm ? 2.6 : 3.2);
    moon.castShadow = true;
    moon.shadow.mapSize.set(3072, 3072);
    const sc = moon.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 42; sc.bottom = -34; sc.near = 5; sc.far = 170;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.05;
    scene.add(moon);
    scene.add(moon.target);
    const fill = new THREE.DirectionalLight(0xa9c4cc, 0.9);
    scene.add(fill);
    const hemi = new THREE.HemisphereLight(0x3d5870, 0x0a1214, 1.6);
    scene.add(hemi);

    // ---- vessel + crew ----
    const ship = vessel.create();
    scene.add(ship.group);
    const crew = createCrew(vessel.crew);
    ship.group.add(crew.group);
    const sailing = new Sailing();

    // ---- wake ----
    const mistTex = makeMistTexture();
    const wakeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const WAKE_N = 110;
    const wake: { m: THREE.Mesh; age: number; life: number; size: number; alive: boolean }[] = [];
    for (let i = 0; i < WAKE_N; i++) {
      const m = new THREE.Mesh(wakeGeo, new THREE.MeshBasicMaterial({
        map: mistTex, transparent: true, depthWrite: false, opacity: 0, color: new THREE.Color(0.78, 0.9, 0.95),
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true,
      }));
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      wake.push({ m, age: 0, life: 1, size: 1, alive: false });
    }
    let wakeCursor = 0;
    let wakeTimer = 0;
    const spawnWake = (x: number, z: number, size: number, t: number) => {
      const w = wake[wakeCursor];
      wakeCursor = (wakeCursor + 1) % WAKE_N;
      w.alive = true;
      w.age = 0;
      w.life = 6 + Math.random() * 3;
      w.size = size;
      w.m.visible = true;
      w.m.position.set(x, waveHeight(x, z, t, seaAmp) + 0.12, z);
      w.m.rotation.y = Math.random() * Math.PI;
    };

    // ---- bow spray ----
    const SPRAY_N = 90;
    const spray: { s: THREE.Sprite; v: THREE.Vector3; age: number; life: number; alive: boolean }[] = [];
    for (let i = 0; i < SPRAY_N; i++) {
      const m = new THREE.SpriteMaterial({
        map: mistTex, color: new THREE.Color(0.85, 0.95, 1.0), transparent: true, depthWrite: false, opacity: 0,
        blending: THREE.AdditiveBlending, fog: true,
      });
      const sp = new THREE.Sprite(m);
      sp.visible = false;
      scene.add(sp);
      spray.push({ s: sp, v: new THREE.Vector3(), age: 0, life: 1, alive: false });
    }
    let sprayCursor = 0;
    let sprayAcc = 0;

    // ---- broadside cannons ----
    const ballGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.8 });
    const balls: { m: THREE.Mesh; v: THREE.Vector3; alive: boolean }[] = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(ballGeo, ballMat);
      m.visible = false;
      scene.add(m);
      balls.push({ m, v: new THREE.Vector3(), alive: false });
    }
    const SMOKE_N = 60;
    const smoke: { s: THREE.Sprite; v: THREE.Vector3; age: number; life: number; alive: boolean }[] = [];
    for (let i = 0; i < SMOKE_N; i++) {
      const m = new THREE.SpriteMaterial({ map: mistTex, color: new THREE.Color(0.55, 0.55, 0.55), transparent: true, depthWrite: false, opacity: 0 });
      const sp = new THREE.Sprite(m);
      sp.visible = false;
      scene.add(sp);
      smoke.push({ s: sp, v: new THREE.Vector3(), age: 0, life: 1, alive: false });
    }
    const flashMat = new THREE.SpriteMaterial({ map: mistTex, color: new THREE.Color(3.0, 1.6, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const flashes: { s: THREE.Sprite; age: number; alive: boolean }[] = [];
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Sprite(flashMat.clone());
      sp.visible = false;
      scene.add(sp);
      flashes.push({ s: sp, age: 0, alive: false });
    }
    const fireLight = new THREE.PointLight(0xffa04a, 0, 60, 1.6);
    scene.add(fireLight);
    let fireLightT = 0;
    let smokeCursor = 0;
    let flashCursor = 0;
    let ballCursor = 0;
    let reloadL = 0;
    let reloadR = 0;
    let recoil = 0;
    const queue: { at: number; idx: number }[] = [];
    const worldQ = new THREE.Quaternion();
    const fireOne = (idx: number) => {
      const c = vessel.cannons[idx];
      const wpos = ship.group.localToWorld(c.pos.clone());
      ship.group.getWorldQuaternion(worldQ);
      const dir = c.dir.clone().applyQuaternion(worldQ);
      dir.y += 0.1;
      dir.normalize();
      const b = balls[ballCursor];
      ballCursor = (ballCursor + 1) % balls.length;
      b.m.position.copy(wpos);
      const fwd = new THREE.Vector3(Math.sin(sailing.heading), 0, Math.cos(sailing.heading)).multiplyScalar(sailing.speed);
      b.v.copy(dir).multiplyScalar(58).add(fwd);
      b.alive = true;
      b.m.visible = true;
      const f = flashes[flashCursor];
      flashCursor = (flashCursor + 1) % flashes.length;
      f.s.position.copy(wpos);
      f.age = 0;
      f.alive = true;
      f.s.visible = true;
      fireLight.position.copy(wpos);
      fireLightT = 0.18;
      for (let i = 0; i < 4; i++) {
        const sm = smoke[smokeCursor];
        smokeCursor = (smokeCursor + 1) % SMOKE_N;
        sm.s.position.copy(wpos).addScaledVector(dir, 0.5 + i * 0.4);
        sm.v.copy(dir).multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2));
        sm.age = 0;
        sm.life = 3.5 + Math.random() * 2;
        sm.alive = true;
        sm.s.visible = true;
      }
      recoil += c.side * -0.004;
    };

    // ---- mist (very light) ----
    const mist: { s: THREE.Sprite; a: number; r: number; h: number; sp: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.SpriteMaterial({
        map: mistTex, color: new THREE.Color(0.32, 0.46, 0.5), transparent: true, depthWrite: false, opacity: 0.04, fog: false,
      });
      const s = new THREE.Sprite(m);
      const szz = 20 + Math.random() * 30;
      s.scale.set(szz, szz * 0.4, 1);
      scene.add(s);
      mist.push({ s, a: Math.random() * Math.PI * 2, r: 18 + Math.random() * 60, h: -0.5 + Math.random() * 2.5, sp: 0.01 + Math.random() * 0.016 });
    }

    // ---- rain (storm only) ----
    const rainN = 5500;
    const rp = new Float32Array(rainN * 2 * 3);
    const re = new Float32Array(rainN * 2);
    for (let i = 0; i < rainN; i++) {
      const x = Math.random() * 90 - 45;
      const y = Math.random() * 60;
      const z = Math.random() * 90 - 45;
      rp.set([x, y, z, x, y, z], i * 6);
      re[i * 2] = 0;
      re[i * 2 + 1] = 1;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    const rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: { uTime, uCam, uFlash },
      transparent: true, depthWrite: false,
    });
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    rain.visible = storm;
    scene.add(rain);

    // ---- post ----
    const size = new THREE.Vector2(mount.clientWidth, mount.clientHeight);
    const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), {
      type: THREE.HalfFloatType, samples: 4,
    });
    const composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(size.clone(), 0.5, 0.8, 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const finish = new ShaderPass(FINISH_SHADER);
    composer.addPass(finish);

    // ---- input ----
    const keyMap: Record<string, keyof typeof controlInput> = {
      KeyW: 'sailUp', ArrowUp: 'sailUp', KeyS: 'sailDown', ArrowDown: 'sailDown',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'fireLeft', KeyE: 'fireRight',
    };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = keyMap[e.code];
      if (k) {
        if ((k === 'fireLeft' || k === 'fireRight') && !down) return;
        controlInput[k] = down;
        e.preventDefault();
      }
    };
    const kd = onKey(true);
    const ku = onKey(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    // ---- hud ----
    const hud = {
      speed: document.getElementById('hud-speed'),
      heading: document.getElementById('hud-heading'),
      sail: document.getElementById('hud-sail'),
      wind: document.getElementById('hud-wind'),
      arrow: document.getElementById('hud-arrow'),
      ship: document.getElementById('hud-ship-arrow'),
    };
    let hudTimer = 0;
    let pr = Math.min(window.devicePixelRatio, 2);
    const prMax = pr;
    let frames = 0;
    let frameAcc = 0;

    // ---- lightning (storm only) ----
    let nextBolt = 3 + Math.random() * 4;
    let boltQueue: { at: number; peak: number }[] = [];
    let flash = 0;

    // ---- loop ----
    const clock = new THREE.Timer();
    let raf = 0;
    let heave = 0;
    let pitch = 0;
    let roll = 0;
    let lastHeading = sailing.heading;
    const lastPos = new THREE.Vector3();
    const sample = vessel.waveSample;
    const tmp = new THREE.Vector3();
    const camOff = new THREE.Vector3();

    const worldPt = (lx: number, lz: number, out: { x: number; z: number }) => {
      const c = Math.cos(sailing.heading);
      const s = Math.sin(sailing.heading);
      out.x = sailing.x + lx * c + lz * s;
      out.z = sailing.z - lx * s + lz * c;
    };
    const wp = { x: 0, z: 0 };
    const hAt = (lx: number, lz: number, t: number) => {
      worldPt(lx, lz, wp);
      return waveHeight(wp.x, wp.z, t, seaAmp);
    };

    const tick = (ts?: number) => {
      raf = requestAnimationFrame(tick);
      clock.update(ts);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsed();
      uTime.value = t;

      sailing.step(dt, t, controlInput, vessel.physics);
      for (const [ix, iz, ir] of ISLANDS) {
        const dx = sailing.x - ix;
        const dz = sailing.z - iz;
        const d = Math.hypot(dx, dz);
        const lim = ir * 0.95 + 14;
        if (d < lim) {
          sailing.x = ix + (dx / d) * lim;
          sailing.z = iz + (dz / d) * lim;
          sailing.speed *= Math.exp(-dt * 3);
        }
      }

      // wave-driven attitude in ship-local axes
      const hb = hAt(0, sample.z, t);
      const hs = hAt(0, -sample.z, t);
      const hr = hAt(sample.x, 0, t);
      const hl = hAt(-sample.x, 0, t);
      const hc = hAt(0, 0, t);
      const targetHeave = (hb + hs + hr + hl + hc * 2) / 6;
      const targetPitch = -Math.atan2(hb - hs, sample.z * 2);
      const heel = sailing.windSide * sailing.sail * Math.min(1, sailing.speed / 4 + 0.25) * 0.1 * sailing.drive;
      const turnLean = -sailing.rudder * Math.min(1, sailing.speed / 4) * 0.05;
      const targetRoll = Math.atan2(hr - hl, sample.x * 2) + heel + turnLean;
      const k = 1 - Math.exp(-dt * 5);
      heave += (targetHeave - heave) * k;
      pitch += (targetPitch - pitch) * k;
      roll += (targetRoll - roll) * k;
      ship.group.position.set(sailing.x, vessel.restHeight + heave, sailing.z);
      ship.group.rotation.set(pitch, sailing.heading, roll, 'YXZ');

      ship.update(t, dt, { sail: sailing.sail, drive: sailing.drive, rudder: sailing.rudder, speed: sailing.speed });
      crew.update({ t, dt, rudder: sailing.rudder, speed: sailing.speed, heel: roll, sail: sailing.sail, camDist: camera.position.distanceTo(ship.group.position) });

      uCenter.value.set(sailing.x, sailing.z);

      // camera follows the ship and keeps its bearing relative to the hull
      tmp.set(sailing.x, vessel.camera.targetY, sailing.z);
      const dYaw = sailing.heading - lastHeading;
      lastHeading = sailing.heading;
      camOff.copy(camera.position).sub(controls.target);
      camOff.applyAxisAngle(THREE.Object3D.DEFAULT_UP, dYaw);
      controls.target.copy(tmp);
      camera.position.copy(tmp).add(camOff);
      if (camera.position.y < 2.5) camera.position.y = 2.5;
      uCam.value.copy(camera.position);
      sky.position.copy(camera.position);
      lastPos.copy(tmp);

      // wake foam trail
      wakeTimer -= dt;
      if (wakeTimer <= 0 && sailing.speed > 0.4) {
        wakeTimer = 0.11;
        worldPt(0, vessel.sternZ - 0.5, wp);
        spawnWake(wp.x, wp.z, 3 + sailing.speed * 0.35, t);
        for (const side of [-1, 1]) {
          worldPt(side * 3.0, vessel.sternZ + 3, wp);
          spawnWake(wp.x, wp.z, 1.8 + sailing.speed * 0.2, t);
        }
      }
      for (const w of wake) {
        if (!w.alive) continue;
        w.age += dt;
        const f = w.age / w.life;
        if (f >= 1) {
          w.alive = false;
          w.m.visible = false;
          continue;
        }
        const sz = w.size * (1 + f * 2.6);
        w.m.scale.set(sz, 1, sz);
        (w.m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - f) * Math.min(1, f * 8) * (0.4 + 0.6 * Math.min(1, sailing.speed / 3));
      }

      // broadsides (Q = left/+x side, E = right/-x side)
      reloadL -= dt;
      reloadR -= dt;
      const wantL = controlInput.fireLeft;
      const wantR = controlInput.fireRight;
      controlInput.fireLeft = false;
      controlInput.fireRight = false;
      if (wantL && reloadL <= 0) {
        reloadL = 5;
        vessel.cannons.forEach((c, i) => { if (c.side > 0) queue.push({ at: t + (i % 8) * 0.14 + Math.random() * 0.08, idx: i }); });
      }
      if (wantR && reloadR <= 0) {
        reloadR = 5;
        vessel.cannons.forEach((c, i) => { if (c.side < 0) queue.push({ at: t + (i % 8) * 0.14 + Math.random() * 0.08, idx: i }); });
      }
      for (let qi = queue.length - 1; qi >= 0; qi--) {
        if (queue[qi].at <= t) {
          fireOne(queue[qi].idx);
          queue.splice(qi, 1);
        }
      }
      recoil *= Math.exp(-dt * 4);
      roll += recoil;
      fireLightT = Math.max(0, fireLightT - dt);
      fireLight.intensity = fireLightT > 0 ? 260 * (fireLightT / 0.18) : 0;
      for (const b of balls) {
        if (!b.alive) continue;
        b.v.y -= 9.8 * dt;
        b.m.position.addScaledVector(b.v, dt);
        const wh = waveHeight(b.m.position.x, b.m.position.z, t, seaAmp);
        if (b.m.position.y < wh) {
          b.alive = false;
          b.m.visible = false;
          for (let i = 0; i < 10; i++) {
            const sp = spray[sprayCursor];
            sprayCursor = (sprayCursor + 1) % SPRAY_N;
            sp.s.position.set(b.m.position.x, wh + 0.2, b.m.position.z);
            sp.v.set((Math.random() - 0.5) * 5, 4 + Math.random() * 6, (Math.random() - 0.5) * 5);
            sp.age = 0;
            sp.life = 0.9 + Math.random() * 0.7;
            sp.alive = true;
            sp.s.visible = true;
          }
        }
      }
      for (const f of flashes) {
        if (!f.alive) continue;
        f.age += dt;
        if (f.age > 0.16) {
          f.alive = false;
          f.s.visible = false;
          continue;
        }
        f.s.scale.setScalar(2.4 + f.age * 14);
        (f.s.material as THREE.SpriteMaterial).opacity = 1 - f.age / 0.16;
      }
      for (const sm of smoke) {
        if (!sm.alive) continue;
        sm.age += dt;
        if (sm.age >= sm.life) {
          sm.alive = false;
          sm.s.visible = false;
          continue;
        }
        sm.s.position.addScaledVector(sm.v, dt);
        sm.v.multiplyScalar(Math.exp(-dt * 0.9));
        const f = sm.age / sm.life;
        sm.s.scale.setScalar(1.6 + f * 6);
        (sm.s.material as THREE.SpriteMaterial).opacity = 0.34 * (1 - f) * Math.min(1, sm.age * 6);
      }

      // bow spray: more of it the faster we go and the harder the bow digs in
      sprayAcc += dt * Math.max(0, sailing.speed - 2.5) * (6 + Math.max(0, -pitch) * 60);
      while (sprayAcc >= 1) {
        sprayAcc -= 1;
        const sp = spray[sprayCursor];
        sprayCursor = (sprayCursor + 1) % SPRAY_N;
        const side = Math.random() > 0.5 ? 1 : -1;
        worldPt(side * (0.4 + Math.random() * 0.6), 17.6 + Math.random() * 1.2, wp);
        sp.s.position.set(wp.x, waveHeight(wp.x, wp.z, t, seaAmp) + 0.3, wp.z);
        const fx = Math.sin(sailing.heading);
        const fz = Math.cos(sailing.heading);
        const sx = Math.cos(sailing.heading) * side;
        const sz = -Math.sin(sailing.heading) * side;
        const out = 1.5 + Math.random() * 2.5;
        sp.v.set(fx * sailing.speed * 0.55 + sx * out, 2.5 + Math.random() * 3.5, fz * sailing.speed * 0.55 + sz * out);
        sp.age = 0;
        sp.life = 0.7 + Math.random() * 0.6;
        sp.alive = true;
        sp.s.visible = true;
      }
      for (const sp of spray) {
        if (!sp.alive) continue;
        sp.age += dt;
        if (sp.age >= sp.life) {
          sp.alive = false;
          sp.s.visible = false;
          continue;
        }
        sp.v.y -= 9 * dt;
        sp.s.position.addScaledVector(sp.v, dt);
        const f = sp.age / sp.life;
        sp.s.scale.setScalar(0.5 + f * 1.4);
        (sp.s.material as THREE.SpriteMaterial).opacity = 0.35 * (1 - f);
      }

      // lightning
      if (storm) {
        nextBolt -= dt;
        if (nextBolt <= 0) {
          nextBolt = 7 + Math.random() * 11;
          const n = 2 + Math.floor(Math.random() * 2);
          boltQueue = [];
          for (let i = 0; i < n; i++) boltQueue.push({ at: t + i * (0.09 + Math.random() * 0.12), peak: 0.7 + Math.random() * 0.8 });
        }
        for (const b of boltQueue) {
          if (b.at <= t) {
            flash = Math.max(flash, b.peak);
            b.at = Infinity;
          }
        }
        flash *= Math.exp(-dt * 7);
        if (flash < 0.002) flash = 0;
      }
      uFlash.value = flash;
      moon.position.set(sailing.x, 0, sailing.z).addScaledVector(MOON_DIR, 70);
      moon.target.position.set(sailing.x, 4, sailing.z);
      moon.intensity = (storm ? 2.6 : 3.2) + flash * 7;
      fill.position.set(sailing.x - 24, 16, sailing.z - 30);
      fill.target.position.set(sailing.x, 6, sailing.z);
      hemi.intensity = 1.6 + flash * 3.5;
      bloom.strength = 0.5 + flash * 0.5;
      const spN = Math.min(1, sailing.speed / 24);
      finish.uniforms.uSpeed.value += (spN * spN - finish.uniforms.uSpeed.value) * Math.min(1, dt * 2);
      const fovT = 48 + spN * 9;
      if (Math.abs(camera.fov - fovT) > 0.01) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 1.5); camera.updateProjectionMatrix(); }

      for (const m of mist) {
        m.a += m.sp * dt;
        m.s.position.set(sailing.x + Math.cos(m.a) * m.r, 2.0 + m.h + Math.sin(t * 0.3 + m.r) * 0.5, sailing.z + Math.sin(m.a) * m.r);
        (m.s.material as THREE.SpriteMaterial).opacity = (0.035 + 0.02 * Math.sin(t * 0.4 + m.r)) * (1 + flash * 2.5);
      }

      // hud at ~6 Hz
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.16;
        const compass = ((-sailing.heading * 180) / Math.PI + 3600) % 360;
        const windCompass = ((-sailing.windFrom * 180) / Math.PI + 3600) % 360;
        if (hud.speed) hud.speed.textContent = (sailing.speed * 1.944).toFixed(1);
        if (hud.heading) hud.heading.textContent = String(Math.round(compass)).padStart(3, '0');
        if (hud.sail) hud.sail.textContent = `${Math.round(sailing.sail * 100)}%`;
        if (hud.wind) hud.wind.textContent = `${pointOfSail(sailing.twa)}  (wind ${String(Math.round(windCompass)).padStart(3, '0')})`;
        const rel = sailing.windFrom - sailing.heading;
        if (hud.arrow) hud.arrow.style.transform = `rotate(${(-rel * 180) / Math.PI + 180}deg)`;
        if (hud.ship) hud.ship.style.transform = `rotate(0deg)`;
      }

      frames++;
      frameAcc += dt;
      if (frameAcc > 2.5) {
        const fps = frames / frameAcc;
        frames = 0;
        frameAcc = 0;
        let next = pr;
        if (fps < 38 && pr > 0.6) next = Math.max(0.6, pr - 0.2);
        else if (fps > 58 && pr < prMax) next = Math.min(prMax, pr + 0.1);
        if (next !== pr) {
          pr = next;
          renderer.setPixelRatio(pr);
          composer.setPixelRatio(pr);
          composer.setSize(mount.clientWidth, mount.clientHeight);
        }
      }

      finish.uniforms.uTime.value = t;
      controls.update();
      composer.render();
    };
    tick();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      controls.dispose();
      ship.dispose();
      crew.dispose();
      oceanGeo.dispose();
      oceanMat.dispose();
      skyMat.dispose();
      rainGeo.dispose();
      rainMat.dispose();
      wakeGeo.dispose();
      wake.forEach((w) => (w.m.material as THREE.Material).dispose());
      spray.forEach((sp) => (sp.s.material as THREE.SpriteMaterial).dispose());
      smoke.forEach((sm) => (sm.s.material as THREE.SpriteMaterial).dispose());
      flashes.forEach((f) => (f.s.material as THREE.SpriteMaterial).dispose());
      flashMat.dispose();
      ballGeo.dispose();
      ballMat.dispose();
      mistTex.dispose();
      mist.forEach((m) => (m.s.material as THREE.SpriteMaterial).dispose());
      composer.dispose();
      rt.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} style={{ position: 'fixed', inset: 0 }} />;
}
