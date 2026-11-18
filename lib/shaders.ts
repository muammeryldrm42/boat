export const NOISE_GLSL = /* glsl */ `
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float a = 0.5; float s = 0.0;
  for(int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

export const SKY_GLSL = /* glsl */ `
uniform vec3 uMoonDir;
uniform float uFlash;
vec3 skyBase(vec3 d){
  float h = clamp(d.y, 0.0, 1.0);
  vec3 horizon = vec3(0.028, 0.046, 0.058);
  vec3 zenith = vec3(0.006, 0.011, 0.02);
  vec3 c = mix(horizon, zenith, pow(h, 0.4));
  c += uFlash * vec3(0.5, 0.58, 0.8) * (0.35 + 0.65 * pow(1.0 - h, 2.0));
  return c;
}
vec3 moonTerm(vec3 d){
  float m = max(dot(d, uMoonDir), 0.0);
  vec3 c = vec3(0.45, 0.62, 0.7) * pow(m, 10.0) * 0.22;
  c += vec3(0.6, 0.78, 0.9) * pow(m, 90.0) * 0.5;
  c += vec3(1.0, 0.97, 0.9) * smoothstep(0.99935, 0.99965, m) * 7.0;
  return c;
}
vec3 skyColor(vec3 d){ return skyBase(d) + moonTerm(d); }
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
${NOISE_GLSL}
${SKY_GLSL}
void main(){
  vec3 d = normalize(vDir);
  vec3 base = skyBase(d);
  float cl = 0.0;
  float rim = 0.0;
  vec2 uv = vec2(0.0);
  if (d.y > 0.0) {
    uv = d.xz / (d.y + 0.2);
    uv *= 0.5;
    uv += uTime * 0.010 * vec2(1.0, 0.4);
    float n = fbm(uv * 1.3);
    float n2 = fbm(uv * 3.1 + n * 1.5 + 5.2);
    float dens = n * 0.7 + n2 * 0.45;
    cl = smoothstep(0.40, 0.74, dens) * smoothstep(0.0, 0.06, d.y);
    float shifted = fbm(uv * 1.3 + uMoonDir.xz * 0.25);
    rim = clamp((n - shifted) * 7.0 + 0.2, 0.0, 1.0);
  }
  float lit = smoothstep(-0.2, 1.0, dot(d, uMoonDir));
  vec3 cloudCol = mix(vec3(0.010, 0.016, 0.023), vec3(0.16, 0.2, 0.25), rim * lit);
  cloudCol += uFlash * vec3(0.38, 0.44, 0.62) * (0.45 + 0.55 * fbm(uv * 2.0));
  vec3 col = mix(base, cloudCol, cl * 0.93) + moonTerm(d) * (1.0 - cl * 0.9);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const OCEAN_VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[5];
uniform float uAmp;
uniform vec3 uCam;
varying vec3 vWorld;
varying vec3 vN;
varying float vFoam;
varying float vDist;
varying float vH;
void main(){
  vec2 p = position.xz;
  float dist = length(p - uCam.xz);
  float fade = 1.0 - 0.85 * smoothstep(90.0, 420.0, dist);
  vec3 disp = vec3(0.0);
  float dxx = 0.0; float dxz = 0.0; float dzz = 0.0; float dyx = 0.0; float dyz = 0.0; float sumA = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 w = uWaves[i];
    float k = w.z;
    float q = w.w * uAmp * fade;
    float c = 0.9 * sqrt(9.81 / k);
    float f = k * (dot(w.xy, p) - c * uTime);
    float S = sin(f); float C = cos(f);
    float a = q / k;
    disp.x += w.x * a * C; disp.z += w.y * a * C; disp.y += a * S;
    dxx += q * w.x * w.x * S; dxz += q * w.x * w.y * S; dzz += q * w.y * w.y * S;
    dyx += q * w.x * C; dyz += q * w.y * C;
    sumA += a;
  }
  vec3 dPdx = vec3(1.0 - dxx, dyx, -dxz);
  vec3 dPdz = vec3(-dxz, dyz, 1.0 - dzz);
  vN = normalize(cross(dPdz, dPdx));
  float jac = (1.0 - dxx) * (1.0 - dzz) - dxz * dxz;
  vFoam = max(smoothstep(0.62, 0.3, jac), smoothstep(0.55, 1.0, disp.y / max(sumA, 0.001)) * 0.55 * fade);
  vH = disp.y / max(sumA, 0.001);
  vec3 wp = vec3(p.x + disp.x, disp.y, p.y + disp.z);
  vWorld = wp;
  vDist = length(uCam - wp);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const OCEAN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform float uFogDensity;
varying vec3 vWorld;
varying vec3 vN;
varying float vFoam;
varying float vDist;
varying float vH;
${NOISE_GLSL}
${SKY_GLSL}
void main(){
  vec2 q = vWorld.xz;
  float t = uTime;
  float detail = 1.0 - smoothstep(50.0, 230.0, vDist);
  vec2 e = vec2(0.14, 0.0);
  vec2 p1 = q * 0.8 + vec2(t * 0.32, t * 0.17);
  float h0 = fbm(p1); float hx = fbm(p1 + e.xy); float hz = fbm(p1 + e.yx);
  vec2 p2 = q * 2.6 - vec2(t * 0.55, t * 0.21);
  float g0 = fbm(p2); float gx = fbm(p2 + e.xy); float gz = fbm(p2 + e.yx);
  vec2 g = (vec2(hx - h0, hz - h0) * 1.0 + vec2(gx - g0, gz - g0) * 0.6) / e.x;
  vec3 N = normalize(vN + vec3(-g.x, 0.0, -g.y) * 0.075 * detail);

  vec3 V = normalize(uCam - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);

  vec3 deep = vec3(0.002, 0.010, 0.016);
  vec3 shallow = vec3(0.014, 0.085, 0.09);
  float crest = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(deep, shallow, crest * crest * 1.1 + 0.06);
  body += vec3(0.01, 0.05, 0.05) * smoothstep(0.55, 1.0, crest) * max(dot(vec3(0.0,1.0,0.0), uMoonDir) + 0.3, 0.0);
  body *= 0.5 + 0.7 * max(dot(N, uMoonDir), 0.0) + uFlash * 1.2;

  vec3 col = mix(body, refl, fres);
  float sp = pow(max(dot(R, uMoonDir), 0.0), 700.0) * 14.0 + pow(max(dot(R, uMoonDir), 0.0), 80.0) * 0.5;
  col += vec3(0.85, 0.95, 1.0) * sp;

  float nf = fbm(q * 0.9 + vec2(t * 0.1, -t * 0.06));
  float foam = clamp(vFoam * 1.25, 0.0, 1.0) * smoothstep(0.34, 0.7, nf + 0.25 * vFoam);
  vec3 foamCol = vec3(0.5, 0.6, 0.63) * (0.16 + 0.55 * max(uMoonDir.y, 0.0) + uFlash * 1.6);
  col = mix(col, foamCol, foam * 0.6);

  vec3 hd = normalize(vec3(-V.x, 0.0, -V.z));
  vec3 fogCol = skyColor(hd) * 0.9 + skyBase(hd) * 0.1;
  float f = 1.0 - exp(-pow(vDist * uFogDensity, 2.0));
  col = mix(col, fogCol, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const RAIN_VERT = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform vec3 uCam;
varying float vA;
void main(){
  vec3 p = position;
  p.y = mod(p.y - uTime * 34.0, 60.0);
  p.x += p.y * 0.14;
  p.xz = mod(p.xz - uCam.xz + 45.0, 90.0) - 45.0 + uCam.xz;
  p.y += uCam.y - 22.0;
  if (aEnd > 0.5) p += vec3(0.14, 1.0, 0.04) * 1.1;
  vA = 1.0 - aEnd * 0.9;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const RAIN_FRAG = /* glsl */ `
varying float vA;
uniform float uFlash;
void main(){
  gl_FragColor = vec4(vec3(0.55, 0.68, 0.78) * (0.9 + uFlash * 3.0), 0.16 * vA);
}
`;

export const FINISH_SHADER = {
  uniforms: { tDiffuse: { value: null as unknown }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float r = dot(c, c);
      vec2 off = c * r * 0.014;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - smoothstep(0.12, 0.75, r * 1.7) * 0.6;
      float g = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + uTime * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
