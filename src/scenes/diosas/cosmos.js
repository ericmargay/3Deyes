import * as THREE from 'three';
import { simplexNoise3D } from '../../shaders/noise.glsl.js';

/**
 * El entorno psicodélico, en capas de profundidad (lo que hace que el
 * estéreo funcione):
 *
 *   cúpula     muy lejos: mármol líquido con domain warping + vórtice + estrellas
 *   galaxia    disco espiral de partículas detrás y abajo de las figuras (ref. 2)
 *   cintas     bandas de luz punteadas que giran ALREDEDOR de la cabeza:
 *              pasan por delante y por detrás de la diosa
 *   destellos  estrellas de 4 puntas en todo el volumen, algunas delante del
 *              plano del mural (salen de la pared en cross-eye / anaglifo)
 *   halo       mandala detrás de cada cabeza (por figura, ver Figure.js)
 *
 * Las capas de luz llevan userData.helper: los clics las atraviesan y llegan
 * a las diosas y sus joyas (reglas "al hacer clic" del editor).
 */

const domeVert = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const domeFrag = /* glsl */ `
  ${simplexNoise3D}
  uniform float uTime, uSpeed, uSwirl, uScale, uIntensity, uGalaxy, uStars, uPulse, uMarble;
  uniform vec3 cBg0, cBg1, cBg2, cRim, cGem, cAccent;
  uniform vec3 uVortex;
  varying vec3 vDir;
  vec3 rotAxis(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
  void main() {
    vec3 d = normalize(vDir);
    float t = uTime * uSpeed;
    float c = dot(d, uVortex);
    float rho = acos(clamp(c, -1.0, 1.0));
    // remolino: gira más cerca del centro del vórtice
    vec3 dw = rotAxis(d, uVortex, uSwirl * 2.5 * exp(-rho * 1.6) + t * 0.15 * uSwirl);
    vec3 q = dw * uScale;
    vec3 w = q + 1.2 * vec3(snoise(q * 0.8 + vec3(0.0, t * 0.12, 0.0)), snoise(q * 0.8 + vec3(5.2, -t * 0.1, 1.3)), snoise(q * 0.8 + vec3(9.1, 2.7, t * 0.09)));
    float n = snoise(w * 1.4 + t * 0.06);
    float bands = sin(n * 7.0 + t * 0.7);
    float veil = smoothstep(-0.1, 0.75, n);
    vec3 col = mix(cBg0, cBg1 * 0.7, veil * uMarble);
    col = mix(col, cBg2 * 0.8, smoothstep(0.75, 1.0, bands) * veil * uMarble);
    col += cRim * smoothstep(0.975, 1.0, bands) * 0.35 * veil * uMarble;
    col *= 0.25 + 0.75 * veil;
    // galaxia: núcleo + brazos espirales en el vórtice
    vec3 ax = normalize(cross(uVortex, vec3(0.0, 1.0, 0.0001)));
    vec3 ay = cross(uVortex, ax);
    float phi = atan(dot(d, ay), dot(d, ax));
    float spiral = sin(phi * 2.0 + log(rho + 0.02) * 5.0 - t * 1.2);
    float arms = smoothstep(0.3, 1.0, spiral) * exp(-rho * 2.2) * (0.6 + 0.4 * snoise(d * 9.0 + t * 0.2));
    col += (cAccent * pow(max(c, 0.0), 60.0) * 4.0 + mix(cGem, cBg2, smoothstep(0.0, 0.8, rho)) * arms * 1.6) * uGalaxy;
    // estrellas
    vec3 sp = d * 220.0;
    vec3 cell = floor(sp);
    float h = hash13(cell);
    float st = step(0.993, h) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
    col += vec3(1.0) * st * uStars * (0.4 + 0.6 * sin(uTime * (1.0 + h * 4.0) + h * 80.0));
    col *= uIntensity * (1.0 + 0.25 * uPulse);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const galaxyVert = /* glsl */ `
  attribute vec4 aData; // radio 0..1, ángulo, altura, azar
  uniform float uTime, uSpin, uRadius, uSize, uPulse, uPixel;
  uniform vec3 cGem, cAccent, cBg2, cRim, cBg1;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float r = aData.x * uRadius;
    float ang = aData.y + uTime * uSpin * (0.25 / (0.12 + aData.x));
    vec3 p = vec3(cos(ang) * r, aData.z * (1.0 - aData.x) * 0.08 * uRadius, sin(ang) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.4 + aData.w * 1.2) * uPixel / max(0.5, -mv.z) * (1.0 + uPulse * 0.6 * aData.w);
    vec3 c = mix(cAccent * 2.2, cGem, smoothstep(0.0, 0.35, aData.x));
    c = mix(c, mix(cBg2, cRim, aData.w), smoothstep(0.35, 1.0, aData.x));
    c = mix(c, cBg1 * 1.5, step(0.8, aData.w) * 0.6);
    vColor = c; vAlpha = 1.0 - smoothstep(0.8, 1.0, aData.x);
  }
`;
const pointFrag = /* glsl */ `
  uniform float uIntensity;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = exp(-dot(c, c) * 18.0);
    gl_FragColor = vec4(vColor * a * vAlpha * uIntensity, 1.0);
  }
`;

const ribbonVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vPosW;
  void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vPosW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const ribbonFrag = /* glsl */ `
  uniform float uTime, uIntensity, uSpeed, uPulse, uSeed;
  uniform vec3 cSkin, cKey, cAccent, cGem, cRim;
  varying vec2 vUv; varying vec3 vPosW;
  vec3 loop4(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    t = fract(t) * 4.0; float f = fract(t); f = f * f * (3.0 - 2.0 * f);
    if (t < 1.0) return mix(a, b, f); if (t < 2.0) return mix(b, c, f); if (t < 3.0) return mix(c, d, f); return mix(d, a, f);
  }
  void main() {
    float u = vUv.x, v = vUv.y;
    vec2 g = vec2(u * 260.0 - uTime * uSpeed * 6.0, v * 5.0);
    vec2 f = fract(g) - 0.5;
    float h = fract(sin(dot(floor(g), vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
    float dots = smoothstep(0.42, 0.1, length(f * vec2(1.0, 1.6))) * step(0.25, h);
    float edge = smoothstep(0.0, 0.25, v) * smoothstep(1.0, 0.75, v);
    float streak = 0.5 + 0.5 * sin(u * 6.2831 * 3.0 - uTime * uSpeed * 1.5 + uSeed);
    vec3 col = loop4(u * 2.0 + h * 0.3 - uTime * uSpeed * 0.05 + uSeed, cGem, cKey, cAccent, cRim);
    float a = edge * (dots * 1.4 + 0.12) * (0.25 + 0.75 * streak) * uIntensity * (1.0 + uPulse);
    gl_FragColor = vec4(col * a, 1.0);
  }
`;

const sparkVert = /* glsl */ `
  attribute vec4 aData;
  uniform float uTime, uSize, uPixel, uPulse, uHigh;
  varying float vTw; varying float vHue;
  void main() {
    vec3 p = position;
    p.y += mod(uTime * (0.1 + aData.w * 0.2) + aData.x * 12.0, 12.0) - 6.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aData.y * 4.0) + aData.z * 40.0);
    tw = pow(tw, 3.0) + uPulse * aData.w + uHigh * aData.y;
    vTw = tw; vHue = aData.z;
    gl_PointSize = min(64.0, uSize * (0.4 + aData.w) * (0.5 + tw) * uPixel / max(2.0, -mv.z));
  }
`;
const sparkFrag = /* glsl */ `
  uniform float uIntensity;
  uniform vec3 cRim, cGem, cAccent;
  varying float vTw; varying float vHue;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float core = exp(-dot(c, c) * 60.0);
    float rays = exp(-abs(c.x) * 60.0) * exp(-abs(c.y) * 5.0) + exp(-abs(c.y) * 60.0) * exp(-abs(c.x) * 5.0);
    vec3 col = mix(mix(vec3(1.0), cRim, 0.4), vHue > 0.5 ? cGem : cAccent, 0.35);
    gl_FragColor = vec4(col * (core * 1.5 + rays) * vTw * uIntensity, 1.0);
  }
`;

const haloVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const haloFrag = /* glsl */ `
  uniform float uTime, uHalo, uPetals, uSpin, uPulse, uBass, uFade;
  uniform vec3 cAccent, cGem, cRim, cKey;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p) / (1.0 + uBass * 0.15), a = atan(p.y, p.x);
    float rot = uTime * uSpin;
    float rays = pow(abs(cos(a * 18.0 - rot * 1.5)), 60.0) * smoothstep(0.98, 0.5, r) * smoothstep(0.42, 0.55, r) * 0.6;
    float pet = cos(a * uPetals + rot) * 0.5 + 0.5;
    float petalEdge = smoothstep(0.03, 0.0, abs(r - (0.55 + 0.12 * pet))) ;
    float pet2 = cos(a * uPetals * 2.0 - rot * 1.3) * 0.5 + 0.5;
    float petalEdge2 = smoothstep(0.02, 0.0, abs(r - (0.72 + 0.06 * pet2)));
    float rings = smoothstep(0.012, 0.0, abs(r - 0.86)) + smoothstep(0.008, 0.0, abs(r - 0.9));
    float beads = smoothstep(0.03, 0.0, length(vec2(r - 0.95, mod(a * 6.0 + rot, 6.2831 / 8.0) - 0.39) * vec2(1.0, 0.3)));
    float aura = exp(-pow((r - 0.42) * 4.5, 2.0)) * (0.3 + 0.7 * uPulse);
    vec3 col = cAccent * rays + cGem * petalEdge * 0.9 + cRim * petalEdge2 * 0.6 + cAccent * rings * 0.7 + cGem * beads * 1.5 + cKey * aura * 0.25;
    col *= smoothstep(1.0, 0.92, r) * uHalo * (1.0 + uPulse * 0.8) * uFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };

export function haloMaterial(U, F) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uFade: F.uFade, uHalo: { value: 1 }, uPetals: { value: 8 }, uSpin: { value: 0.1 }, uBass: { value: 0 } },
    vertexShader: haloVert, fragmentShader: haloFrag, ...additive, side: THREE.DoubleSide,
  });
}

export class Cosmos {
  constructor(U) {
    this.U = U;
    this.group = new THREE.Group(); this.group.name = 'cosmos';
    this.pixel = { value: 800 };

    // cúpula
    this.domeU = { uSpeed: { value: 0.3 }, uSwirl: { value: 1 }, uScale: { value: 1.6 }, uIntensity: { value: 1 }, uGalaxy: { value: 0.7 }, uStars: { value: 1 }, uMarble: { value: 1 }, uVortex: { value: new THREE.Vector3(0, -0.25, -1).normalize() } };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(120, 64, 32), new THREE.ShaderMaterial({ uniforms: { ...U, ...this.domeU }, vertexShader: domeVert, fragmentShader: domeFrag, side: THREE.BackSide, depthWrite: false }));
    this.dome.name = 'cúpula'; this.dome.renderOrder = -10; this.dome.frustumCulled = false; this.dome.userData.helper = true;
    this.group.add(this.dome);

    // galaxia
    this.galaxyU = { uSpin: { value: 0.3 }, uRadius: { value: 16 }, uSize: { value: 0.16 }, uPixel: this.pixel, uIntensity: { value: 1 } };
    this.galaxy = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: { ...U, ...this.galaxyU }, vertexShader: galaxyVert, fragmentShader: pointFrag, ...additive }));
    this.galaxy.name = 'galaxia'; this.galaxy.frustumCulled = false; this.galaxy.userData.helper = true;
    this.galaxy.position.set(0, -4.5, -24); this.galaxy.rotation.set(0.42, 0, 0.12);
    this.group.add(this.galaxy);
    this.setGalaxyCount(30000);

    // cintas alrededor de la figura principal
    this.ribbons = new THREE.Group(); this.ribbons.name = 'cintas';
    this.ribbonU = { uIntensity: { value: 1 }, uSpeed: { value: 1 } };
    this.group.add(this.ribbons);
    this.setRibbonCount(4);

    // destellos
    this.sparkU = { uSize: { value: 0.35 }, uPixel: this.pixel, uIntensity: { value: 1 }, uHigh: { value: 0 } };
    this.sparks = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: { ...U, ...this.sparkU }, vertexShader: sparkVert, fragmentShader: sparkFrag, ...additive }));
    this.sparks.name = 'destellos'; this.sparks.frustumCulled = false; this.sparks.userData.helper = true;
    this.group.add(this.sparks);
    this.setSparkCount(320);
  }

  setGalaxyCount(n) {
    const rnd = rng(11), data = new Float32Array(n * 4), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const arm = i % 3;
      const r = Math.pow(rnd(), 0.65);
      const spread = (rnd() - 0.5) * (0.5 + r * 0.9) * (rnd() < 0.15 ? 3 : 1);
      data[i * 4] = r;
      data[i * 4 + 1] = (arm / 3) * Math.PI * 2 + Math.log(r + 0.05) * 2.6 + spread;
      data[i * 4 + 2] = (rnd() + rnd() + rnd() - 1.5);
      data[i * 4 + 3] = rnd();
    }
    const g = this.galaxy.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    g.setDrawRange(0, n);
  }

  setRibbonCount(n) {
    for (const c of [...this.ribbons.children]) { this.ribbons.remove(c); c.geometry.dispose(); }
    const rnd = rng(23);
    for (let k = 0; k < n; k++) {
      const R = 2.2 + k * 0.55 + rnd() * 0.3, e = 0.25 + rnd() * 0.35, wob = 0.3 + rnd() * 0.5, ph = rnd() * 6.28, lobes = 2 + (k % 3);
      const pts = [];
      for (let i = 0; i < 160; i++) {
        const s = (i / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(s) * R, Math.sin(s * lobes + ph) * wob + Math.sin(s) * R * e * 0.4, Math.sin(s) * R * (0.7 + e * 0.4)));
      }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const N = 400, W = 0.1 + rnd() * 0.22;
      const pos = new Float32Array((N + 1) * 2 * 3), uv = new Float32Array((N + 1) * 2 * 2), idx = [];
      const T = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), out = new THREE.Vector3();
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        curve.getPointAt(u % 1, P); curve.getTangentAt(u % 1, T);
        out.copy(P).normalize();
        B.crossVectors(T, out).normalize();
        const w = W * (0.6 + 0.4 * Math.sin(u * Math.PI * 2 * lobes + ph));
        for (let s = 0; s < 2; s++) {
          const q = P.clone().addScaledVector(B, (s - 0.5) * w);
          pos.set([q.x, q.y, q.z], (i * 2 + s) * 3); uv.set([u, s], (i * 2 + s) * 2);
        }
        if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { ...this.U, ...this.ribbonU, uSeed: { value: k * 1.7 } }, vertexShader: ribbonVert, fragmentShader: ribbonFrag, ...additive, side: THREE.DoubleSide }));
      m.name = `cinta ${k + 1}`; m.frustumCulled = false; m.userData.helper = true;
      m.rotation.set((rnd() - 0.5) * 0.9, rnd() * 6.28, (rnd() - 0.5) * 0.7);
      m.userData.spin = (0.05 + rnd() * 0.12) * (k % 2 ? -1 : 1);
      this.ribbons.add(m);
    }
  }

  setSparkCount(n) {
    const rnd = rng(5), pos = new Float32Array(n * 3), data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const z = -26 + Math.pow(rnd(), 0.8) * 29;
      const spread = 3 + (10 - z) * 0.45;
      pos.set([(rnd() - 0.5) * spread * 2, (rnd() - 0.5) * spread * 1.4, z], i * 3);
      data.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    const g = this.sparks.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
  }

  update(dt, s) {
    for (const r of this.ribbons.children) r.rotation.y += r.userData.spin * dt * s.ribbonSpin;
  }
}
