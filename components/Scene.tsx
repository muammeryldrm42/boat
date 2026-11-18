'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createShip } from '@/lib/ship';
import { WAVE_UNIFORMS, waveHeight } from '@/lib/waves';
import {
  SKY_VERT, SKY_FRAG, OCEAN_VERT, OCEAN_FRAG, RAIN_VERT, RAIN_FRAG, FINISH_SHADER,
} from '@/lib/shaders';
import { makeMistTexture } from '@/lib/textures';

const MOON_DIR = new THREE.Vector3(-0.72, 0.34, -0.5).normalize();
const FOG_DENSITY = 0.0028;

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

export default function Scene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(new THREE.Color(0.028, 0.046, 0.058), FOG_DENSITY);

    const camera = new THREE.PerspectiveCamera(46, mount.clientWidth / mount.clientHeight, 0.3, 4000);
    camera.position.set(30, 9, 26);
    const qs = new URLSearchParams(window.location.search);
    const camQ = qs.get('cam');
    if (camQ) {
      const c = camQ.split(',').map(Number);
      if (c.length === 3 && c.every((n) => Number.isFinite(n))) camera.position.set(c[0], c[1], c[2]);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 8, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 14;
    controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotate = !camQ;
    controls.autoRotateSpeed = 0.35;
    let idleTimer = 0;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      idleTimer = 0;
    });

    // ---- shared uniforms ----
    const uFlash = { value: 0 };
    const uMoonDir = { value: MOON_DIR.clone() };
    const uTime = { value: 0 };
    const uCam = { value: new THREE.Vector3() };

    // ---- sky ----
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime, uFlash, uMoonDir },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 32), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    // ---- ocean ----
    const oceanMat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: {
        uTime, uCam, uFlash, uMoonDir,
        uWaves: { value: WAVE_UNIFORMS },
        uAmp: { value: 1.3 },
        uFogDensity: { value: FOG_DENSITY },
      },
    });
    const oceanGeo = buildOceanGeometry(0.6, 2200, 240, 420);
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.frustumCulled = false;
    scene.add(ocean);

    // ---- lights ----
    const moon = new THREE.DirectionalLight(0x9fb8e8, 2.6);
    moon.position.copy(MOON_DIR).multiplyScalar(70);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 40; sc.bottom = -34; sc.near = 5; sc.far = 160;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.05;
    scene.add(moon);
    const fill = new THREE.DirectionalLight(0xa9c4cc, 1.5);
    fill.position.set(30, 14, 28);
    scene.add(fill);
    const hemi = new THREE.HemisphereLight(0x3a5668, 0x0a1214, 1.5);
    scene.add(hemi);

    // ---- ship ----
    const ship = createShip();
    scene.add(ship.group);

    // ---- mist sprites ----
    const mistTex = makeMistTexture();
    const mist: { s: THREE.Sprite; a: number; r: number; h: number; sp: number }[] = [];
    for (let i = 0; i < 46; i++) {
      const m = new THREE.SpriteMaterial({
        map: mistTex, color: new THREE.Color(0.32, 0.5, 0.52), transparent: true, depthWrite: false,
        opacity: 0.06, fog: false,
      });
      const s = new THREE.Sprite(m);
      const sz = 16 + Math.random() * 26;
      s.scale.set(sz, sz * 0.5, 1);
      scene.add(s);
      mist.push({ s, a: Math.random() * Math.PI * 2, r: 12 + Math.random() * 50, h: -0.5 + Math.random() * 3.5, sp: 0.012 + Math.random() * 0.02 });
    }

    // ---- rain ----
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
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: { uTime, uCam, uFlash },
      transparent: true,
      depthWrite: false,
    });
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    scene.add(rain);

    // ---- post ----
    const size = new THREE.Vector2(mount.clientWidth, mount.clientHeight);
    const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), {
      type: THREE.HalfFloatType, samples: 4,
    });
    const composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(size.clone(), 0.5, 0.7, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const finish = new ShaderPass(FINISH_SHADER);
    composer.addPass(finish);

    // ---- lightning ----
    let nextBolt = 3 + Math.random() * 4;
    let boltQueue: { at: number; peak: number }[] = [];
    let flash = 0;

    // ---- loop ----
    const clock = new THREE.Clock();
    let raf = 0;
    let shipPitch = 0;
    let shipRoll = 0;
    let shipHeave = 0;
    const SEP_Z = 13;
    const SEP_X = 3.6;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      uTime.value = t;
      uCam.value.copy(camera.position);

      if (!controls.autoRotate) {
        idleTimer += dt;
        if (idleTimer > 14) controls.autoRotate = true;
      }

      // ship motion from the same wave maths as the shader
      const hb = waveHeight(0, SEP_Z, t, 1.3);
      const hs = waveHeight(0, -SEP_Z, t, 1.3);
      const hr = waveHeight(SEP_X, 0, t, 1.3);
      const hl = waveHeight(-SEP_X, 0, t, 1.3);
      const hc = waveHeight(0, 0, t, 1.3);
      const targetHeave = (hb + hs + hr + hl + hc * 2) / 6;
      const targetPitch = -Math.atan2(hb - hs, SEP_Z * 2);
      const targetRoll = Math.atan2(hr - hl, SEP_X * 2);
      const k = 1 - Math.exp(-dt * 3.2);
      shipHeave += (targetHeave - shipHeave) * k;
      shipPitch += (targetPitch - shipPitch) * k;
      shipRoll += (targetRoll - shipRoll) * k;
      ship.group.position.y = 2.55 + shipHeave;
      ship.group.rotation.set(shipPitch, 0, shipRoll + Math.sin(t * 0.37) * 0.012);
      ship.update(t, dt);

      // lightning
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
      uFlash.value = flash;
      moon.intensity = 2.6 + flash * 7;
      hemi.intensity = 1.5 + flash * 3.5;
      bloom.strength = 0.5 + flash * 0.5;

      // clamp camera above the sea
      if (camera.position.y < 2.5) camera.position.y = 2.5;
      sky.position.copy(camera.position);

      for (const m of mist) {
        m.a += m.sp * dt;
        m.s.position.set(Math.cos(m.a) * m.r, 2.2 + m.h + Math.sin(t * 0.3 + m.r) * 0.6, Math.sin(m.a) * m.r);
        (m.s.material as THREE.SpriteMaterial).opacity = (0.05 + 0.03 * Math.sin(t * 0.4 + m.r)) * (1 + flash * 2.5);
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
      controls.dispose();
      ship.dispose();
      oceanGeo.dispose();
      oceanMat.dispose();
      skyMat.dispose();
      rainGeo.dispose();
      rainMat.dispose();
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
