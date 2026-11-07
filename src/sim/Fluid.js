import * as THREE from 'three';

/**
 * Fluido 2D en GPU (Navier–Stokes incompresible, "stable fluids" de Jos Stam):
 * advección semi-lagrangiana, confinamiento de vorticidad, proyección de
 * presión con Jacobi. Estructura de pasadas al estilo de WebGL-Fluid-Simulation
 * (Pavel Dobryakov, MIT), escrita de nuevo para three.js.
 *
 *  velocity  RG  (celdas / s, grilla de simulación)
 *  ink       RGBA (tinta; A = canal libre que se advecta igual; la disipación
 *            puede ser distinta por canal: dyeDissipation = [r, g, b, a])
 *
 * Simetría (opcional): espejo (bilateral, test de Rorschach) o diedral de n
 * pliegues (caleidoscopio). Los golpes se replican en todo el grupo y una
 * pasada de simetrización corrige la deriva numérica, así el patrón queda
 * exactamente simétrico.
 */
const baseVert = /* glsl */ `
  varying vec2 vUv, vL, vR, vT, vB;
  uniform vec2 texelSize;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const head = /* glsl */ `precision highp float; precision highp sampler2D; varying vec2 vUv, vL, vR, vT, vB; uniform vec2 texelSize;`;

const SHADERS = {
  advect: `${head}
    uniform sampler2D uVelocity, uSource; uniform vec2 velTexel; uniform float dt; uniform vec4 dissipation;
    void main() {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * velTexel;
      gl_FragColor = texture2D(uSource, coord) / (1.0 + dissipation * dt);
    }`,
  divergence: `${head}
    uniform sampler2D uVelocity;
    void main() {
      float L = texture2D(uVelocity, vL).x, R = texture2D(uVelocity, vR).x, T = texture2D(uVelocity, vT).y, B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`,
  curl: `${head}
    uniform sampler2D uVelocity;
    void main() {
      float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y, T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
      gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }`,
  vorticity: `${head}
    uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
    void main() {
      float L = texture2D(uCurl, vL).x, R = texture2D(uCurl, vR).x, T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x, C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C; force.y *= -1.0;
      vec2 v = texture2D(uVelocity, vUv).xy + force * dt;
      gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
    }`,
  clear: `${head}
    uniform sampler2D uTexture; uniform float value;
    void main() { gl_FragColor = value * texture2D(uTexture, vUv); }`,
  pressure: `${head}
    uniform sampler2D uPressure, uDivergence;
    void main() {
      float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x, T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
      gl_FragColor = vec4((L + R + B + T - texture2D(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
    }`,
  gradient: `${head}
    uniform sampler2D uPressure, uVelocity;
    void main() {
      float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x, T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
      vec2 v = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
      gl_FragColor = vec4(v, 0.0, 1.0);
    }`,
  // hasta 24 golpes por pasada: pos.xy, pos.z = radio², pos.w = tipo
  //   0 disco gaussiano · 1 anillo · 2 anillo radial (empuja hacia afuera, magnitud = val.x) · 3 estallido radial
  //   4 borrar (multiplica por 1 - val.x·k: burbujas de aire en la tinta)
  splat: `${head}
    #define MAXS 24
    uniform sampler2D uTarget; uniform float aspect; uniform int count;
    uniform vec4 sPos[MAXS]; uniform vec4 sVal[MAXS];
    void main() {
      vec4 acc = texture2D(uTarget, vUv);
      for (int i = 0; i < MAXS; i++) {
        if (i >= count) break;
        vec2 p = vUv - sPos[i].xy; p.x *= aspect;
        float d2 = dot(p, p), r2 = sPos[i].z, type = sPos[i].w;
        bool ring = type > 0.5 && type < 1.5 || type > 1.5 && type < 2.5;
        float k = ring ? exp(-pow(sqrt(d2) - sqrt(r2) * 2.0, 2.0) / (r2 * 0.25)) : exp(-d2 / r2);
        if (type > 3.5) { acc *= 1.0 - clamp(sVal[i].x * k, 0.0, 1.0); continue; }
        vec4 val = sVal[i];
        if (type > 1.5) val = vec4(p / (sqrt(d2) + 1e-5) * sVal[i].x, 0.0, 0.0);
        acc += val * k;
      }
      gl_FragColor = acc;
    }`,
  // expansión de la tinta: difusión no lineal (ecuación de medio poroso, D ∝ ρ^power).
  // Es la física de una película de tinta aplastada: frente nítido que avanza
  // rápido donde hay mucha tinta y se frena cuando se adelgaza. Conserva la tinta.
  // Con noise > 0 la facilidad de avance varía en el papel: el frente avanza
  // por canales y salen dedos y ramificaciones (como al despegar dos hojas).
  spread: `${head}
    uniform sampler2D uSource; uniform float D, power, noise, aspect; uniform vec2 seed;
    float rho(vec4 c) { return max(0.0, (c.r + c.g + c.b) / 3.0); }
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
    float perm(vec2 uv) {
      vec2 p = vec2(uv.x * aspect, uv.y) * 38.0 + seed;
      float n = 0.5 * vn(p) + 0.3 * vn(p * 2.3 + 5.1) + 0.2 * vn(p * 5.3 - 2.7);
      return mix(1.0, pow(smoothstep(0.25, 0.75, n), 3.0) * 2.6, noise);
    }
    float k(float a, float b, float m) { return min(0.24, D * m * pow(0.5 * (a + b), power)); }
    void main() {
      vec4 C = texture2D(uSource, vUv), L = texture2D(uSource, vL), R = texture2D(uSource, vR), T = texture2D(uSource, vT), B = texture2D(uSource, vB);
      float rc = rho(C), m = perm(vUv);
      gl_FragColor = C + k(rc, rho(L), m) * (L - C) + k(rc, rho(R), m) * (R - C) + k(rc, rho(T), m) * (T - C) + k(rc, rho(B), m) * (B - C);
    }`,
  // simetrización: promedio sobre el grupo (espejo o diedral de n pliegues)
  symmetrize: `${head}
    uniform sampler2D uSource; uniform float aspect, folds, isVector, radius; uniform int mode;
    vec2 toUv(vec2 q) { return vec2(q.x / aspect, q.y) + 0.5; }
    void main() {
      vec4 a = texture2D(uSource, vUv);
      if (mode == 1) {
        vec4 b = texture2D(uSource, vec2(1.0 - vUv.x, vUv.y));
        if (isVector > 0.5) b.x = -b.x;
        gl_FragColor = 0.5 * (a + b); return;
      }
      vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
      if (length(q) > radius) { gl_FragColor = a * (isVector > 0.5 ? 0.9 : 0.85); return; }
      vec4 acc = vec4(0.0); float n = 0.0;
      for (int k = 0; k < 16; k++) {
        if (float(k) >= folds) break;
        float th = 6.2831853 * float(k) / folds, c = cos(th), s = sin(th);
        for (int m = 0; m < 2; m++) {
          vec2 g = q; if (m == 1) g.y = -g.y;
          g = vec2(c * g.x - s * g.y, s * g.x + c * g.y);
          vec4 v = texture2D(uSource, toUv(g));
          if (isVector > 0.5) {   // g⁻¹ v = F · R(-θ) · v
            vec2 w = vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
            if (m == 1) w.y = -w.y;
            v.xy = w;
          }
          acc += v; n += 1.0;
        }
      }
      gl_FragColor = acc / n;
    }`,
};

const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
class Double {
  constructor(w, h) { this.read = new THREE.WebGLRenderTarget(w, h, rtOpts); this.write = new THREE.WebGLRenderTarget(w, h, rtOpts); }
  swap() { const t = this.read; this.read = this.write; this.write = t; }
  dispose() { this.read.dispose(); this.write.dispose(); }
}

export class Fluid {
  /**
   * @param renderer  WebGLRenderer
   * @param o  { aspect, simRes, dyeRes, curl, velDissipation, dyeDissipation, pressureIters, pressureDecay }
   */
  constructor(renderer, o = {}) {
    this.r = renderer;
    this.o = { aspect: 16 / 9, simRes: 160, dyeRes: 768, curl: 25, velDissipation: 0.25, dyeDissipation: 0.6, pressureIters: 22, pressureDecay: 0.8, ...o };
    this.symmetry = { mode: 0, folds: 6, radius: 0.48 };   // mode 0 ninguna · 1 espejo · 2 diedral
    this.spread = { D: 0, power: 1.5, iters: 0, noise: 0, seed: new THREE.Vector2() };   // expansión de la tinta (ver shader spread)
    this.splatsVel = []; this.splatsDye = [];
    this.mats = {};
    for (const [k, frag] of Object.entries(SHADERS)) {
      this.mats[k] = new THREE.ShaderMaterial({ vertexShader: baseVert, fragmentShader: frag, uniforms: { texelSize: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    }
    const u = (m, defs) => Object.assign(this.mats[m].uniforms, Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, { value: v }])));
    u('advect', { uVelocity: null, uSource: null, velTexel: new THREE.Vector2(), dt: 0, dissipation: new THREE.Vector4() });
    u('divergence', { uVelocity: null }); u('curl', { uVelocity: null });
    u('vorticity', { uVelocity: null, uCurl: null, curl: 0, dt: 0 });
    u('clear', { uTexture: null, value: 0.8 }); u('pressure', { uPressure: null, uDivergence: null });
    u('gradient', { uPressure: null, uVelocity: null });
    u('splat', { uTarget: null, aspect: 1, count: 0, sPos: Array.from({ length: 24 }, () => new THREE.Vector4()), sVal: Array.from({ length: 24 }, () => new THREE.Vector4()) });
    u('symmetrize', { uSource: null, aspect: 1, folds: 6, isVector: 0, radius: 0.48, mode: 0 });
    u('spread', { uSource: null, D: 0, power: 1.5, noise: 0, aspect: 1, seed: new THREE.Vector2() });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mats.advect); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.resize();
  }

  resize(o = {}) {
    Object.assign(this.o, o);
    const { aspect, simRes, dyeRes } = this.o;
    const sw = Math.round(simRes * Math.max(1, aspect)), sh = Math.round(simRes / Math.min(1, aspect));
    const dw = Math.round(dyeRes * Math.max(1, aspect)), dh = Math.round(dyeRes / Math.min(1, aspect));
    for (const k of ['velocity', 'ink', 'pressure']) this[k]?.dispose();
    this.divergenceRT?.dispose(); this.curlRT?.dispose();
    this.velocity = new Double(sw, sh); this.pressure = new Double(sw, sh); this.ink = new Double(dw, dh);
    this.divergenceRT = new THREE.WebGLRenderTarget(sw, sh, rtOpts); this.curlRT = new THREE.WebGLRenderTarget(sw, sh, rtOpts);
    this.simTexel = new THREE.Vector2(1 / sw, 1 / sh); this.dyeTexel = new THREE.Vector2(1 / dw, 1 / dh);
    this.clearAll();
  }

  clearAll() {
    const r = this.r, prev = r.getRenderTarget(), cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const d of [this.velocity, this.pressure, this.ink]) for (const t of [d.read, d.write]) { r.setRenderTarget(t); r.clear(); }
    r.setClearColor(cc, ca); r.setRenderTarget(prev);
  }

  run(mat, target, texel) {
    mat.uniforms.texelSize.value.copy(texel);
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  /** Golpe de color: x, y en 0..1, radio en fracción de la altura, color rgb (+ a). */
  dye(x, y, radius, r, g, b, a = 0) { this.pushSym(this.splatsDye, x, y, radius, [r, g, b, a], false, 0); }
  /** Golpe de fuerza: vx, vy en celdas / s. ring = true dibuja un anillo. */
  force(x, y, radius, vx, vy, ring = false) { this.pushSym(this.splatsVel, x, y, radius, [vx, vy, 0, 0], true, ring ? 1 : 0); }
  /** Burbuja de aire: borra tinta (amount 0..1 en el centro). */
  erase(x, y, radius, amount = 1) { this.pushSym(this.splatsDye, x, y, radius, [amount, 0, 0, 0], false, 4); }
  /** Empuje radial hacia afuera (negativo = hacia adentro). ring = true: onda expansiva en un anillo. */
  burst(x, y, radius, strength, ring = false) { this.pushSym(this.splatsVel, x, y, radius, [strength, 0, 0, 0], false, ring ? 2 : 3); }

  pushSym(list, x, y, radius, val, isVec, type) {
    const S = this.symmetry, aspect = this.o.aspect, r2 = radius * radius;
    if (S.mode === 0) { list.push([x, y, r2, type, ...val]); return; }
    if (S.mode === 1) {
      list.push([x, y, r2, type, ...val]);
      list.push([1 - x, y, r2, type, isVec ? -val[0] : val[0], val[1], val[2], val[3]]);
      return;
    }
    // diedral: todas las rotaciones y reflexiones alrededor del centro
    const qx = (x - 0.5) * aspect, qy = y - 0.5, n = S.folds;
    for (let k = 0; k < n; k++) {
      const th = (Math.PI * 2 * k) / n, c = Math.cos(th), s = Math.sin(th);
      for (let m = 0; m < 2; m++) {
        const gy = m ? -qy : qy, px = c * qx - s * gy, py = s * qx + c * gy;
        let v = val;
        if (isVec) { const vy = m ? -val[1] : val[1]; v = [c * val[0] - s * vy, s * val[0] + c * vy, 0, 0]; }
        list.push([px / aspect + 0.5, py + 0.5, r2, type, ...v]);
      }
    }
  }

  flushSplats(list, target, texel) {
    const m = this.mats.splat;
    m.uniforms.aspect.value = this.o.aspect;
    for (let i = 0; i < list.length; i += 24) {
      const chunk = list.slice(i, i + 24);
      chunk.forEach((s, j) => { m.uniforms.sPos.value[j].set(s[0], s[1], s[2], s[3]); m.uniforms.sVal.value[j].set(s[4], s[5], s[6], s[7]); });
      m.uniforms.count.value = chunk.length;
      m.uniforms.uTarget.value = target.read.texture;
      this.run(m, target.write, texel); target.swap();
    }
    list.length = 0;
  }

  symmetrize(target, texel, isVector) {
    const S = this.symmetry; if (S.mode === 0) return;
    const m = this.mats.symmetrize;
    m.uniforms.uSource.value = target.read.texture; m.uniforms.aspect.value = this.o.aspect; m.uniforms.folds.value = S.folds;
    m.uniforms.isVector.value = isVector ? 1 : 0; m.uniforms.radius.value = S.radius; m.uniforms.mode.value = S.mode;
    this.run(m, target.write, texel); target.swap();
  }

  step(dt) {
    dt = Math.min(dt, 1 / 30);
    const r = this.r, prev = r.getRenderTarget(), M = this.mats, o = this.o, st = this.simTexel;
    const ac = r.autoClear; r.autoClear = false;
    this.flushSplats(this.splatsVel, this.velocity, st);
    this.flushSplats(this.splatsDye, this.ink, this.dyeTexel);
    // vorticidad
    M.curl.uniforms.uVelocity.value = this.velocity.read.texture; this.run(M.curl, this.curlRT, st);
    M.vorticity.uniforms.uVelocity.value = this.velocity.read.texture; M.vorticity.uniforms.uCurl.value = this.curlRT.texture;
    M.vorticity.uniforms.curl.value = o.curl; M.vorticity.uniforms.dt.value = dt;
    this.run(M.vorticity, this.velocity.write, st); this.velocity.swap();
    // proyección
    M.divergence.uniforms.uVelocity.value = this.velocity.read.texture; this.run(M.divergence, this.divergenceRT, st);
    M.clear.uniforms.uTexture.value = this.pressure.read.texture; M.clear.uniforms.value.value = o.pressureDecay; this.run(M.clear, this.pressure.write, st); this.pressure.swap();
    M.pressure.uniforms.uDivergence.value = this.divergenceRT.texture;
    for (let i = 0; i < o.pressureIters; i++) { M.pressure.uniforms.uPressure.value = this.pressure.read.texture; this.run(M.pressure, this.pressure.write, st); this.pressure.swap(); }
    M.gradient.uniforms.uPressure.value = this.pressure.read.texture; M.gradient.uniforms.uVelocity.value = this.velocity.read.texture;
    this.run(M.gradient, this.velocity.write, st); this.velocity.swap();
    // advección
    const A = M.advect.uniforms;
    A.velTexel.value.copy(st); A.dt.value = dt;
    A.uVelocity.value = this.velocity.read.texture; A.uSource.value = this.velocity.read.texture; A.dissipation.value.setScalar(o.velDissipation);
    this.run(M.advect, this.velocity.write, st); this.velocity.swap();
    A.uVelocity.value = this.velocity.read.texture; A.uSource.value = this.ink.read.texture;
    if (Array.isArray(o.dyeDissipation)) A.dissipation.value.fromArray(o.dyeDissipation); else A.dissipation.value.setScalar(o.dyeDissipation);
    this.run(M.advect, this.ink.write, this.dyeTexel); this.ink.swap();
    // expansión (medio poroso)
    const SP = this.spread;
    if (SP.iters > 0 && SP.D > 0) {
      const m = M.spread.uniforms; m.D.value = SP.D; m.power.value = SP.power; m.noise.value = SP.noise; m.aspect.value = o.aspect; m.seed.value.copy(SP.seed);
      for (let i = 0; i < SP.iters; i++) { m.uSource.value = this.ink.read.texture; this.run(M.spread, this.ink.write, this.dyeTexel); this.ink.swap(); }
    }
    // simetría exacta
    this.symmetrize(this.velocity, st, true);
    this.symmetrize(this.ink, this.dyeTexel, false);
    r.autoClear = ac; r.setRenderTarget(prev);
  }

  /** Copia la tinta actual a otro render target (para congelarla, p. ej. una carta que se va). */
  copyInk(target) {
    const r = this.r, prev = r.getRenderTarget(), M = this.mats.clear;
    M.uniforms.uTexture.value = this.ink.read.texture; M.uniforms.value.value = 1;
    this.run(M, target, this.dyeTexel); r.setRenderTarget(prev);
  }
  /** Render target compatible con la tinta (mismo tamaño y formato). */
  makeInkTarget() { return new THREE.WebGLRenderTarget(this.ink.read.width, this.ink.read.height, rtOpts); }

  get dyeTexture() { return this.ink.read.texture; }
  get velocityTexture() { return this.velocity.read.texture; }

  dispose() { this.velocity.dispose(); this.pressure.dispose(); this.ink.dispose(); this.divergenceRT.dispose(); this.curlRT.dispose(); for (const m of Object.values(this.mats)) m.dispose(); }
}
