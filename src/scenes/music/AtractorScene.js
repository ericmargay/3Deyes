import * as THREE from 'three';
import { MusicScene } from './MusicScene.js';

/**
 * ATRACTOR: la forma de onda misma, dibujada como un osciloscopio de fósforo
 * en tres dimensiones. Cada instante del sonido es un punto
 *
 *     (s(t), s(t − τ), s(t − 2τ))        inmersión de Takens
 *
 * y la curva que forman las últimas muestras es el "retrato de fase" del
 * sonido: un tono puro es un anillo, una quinta es un nudo de Lissajous, un
 * acorde es una trenza, el ruido es una nube y el bombo es un latigazo que
 * sale del centro. La forma ES el sonido, sin interpretación de por medio.
 *
 * τ se ajusta solo a la nota de la melodía (un cuarto de período: así un tono
 * dibuja un círculo) o se fija a mano. Modo estéreo XY: (L, R, L(t − τ)), el
 * osciloscopio clásico con profundidad. Las curvas anteriores se hunden hacia
 * el fondo (el pasado se aleja), como la persistencia del fósforo. Donde el
 * haz va lento brilla más, como en un tubo de rayos catódicos.
 *
 * Interacción: arrastrar gira, rueda cambia τ. Pad Kaoss: X = τ, Y = estela.
 */
const M = 1024, K = 32;
const MODES = ['takens', 'estéreo XY', 'hélice'];
const BANDS = { grave: [28, 240], medio: [260, 1100], agudo: [1200, 6000], completo: [28, 5000] };

/** Biquad (RBJ) aplicado en el lugar: tipo 'lp' o 'hp'. */
function biquad(x, n, type, f0, sr, Q = 0.707) {
  const w = (2 * Math.PI * f0) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; } else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  const a0 = 1 + al, a1 = -2 * cw / a0, a2 = (1 - al) / a0; b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) { const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
}

const vert = /* glsl */ `
  uniform sampler2D tCurve;
  uniform float head, depth, width, scale, phosphor, count;
  uniform vec2 resolution;
  attribute vec3 aRef;
  varying float vBright, vSide, vU, vAge;
  vec3 P(float i, float row) { return texelFetch(tCurve, ivec2(int(clamp(i, 0.0, count - 1.0)), int(row)), 0).xyz; }
  void main() {
    float i = aRef.x, a = aRef.y;
    vSide = aRef.z; vU = i / count; vAge = a / ${K}.0;
    if (i >= count) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float row = mod(head - a + ${K}.0, ${K}.0);
    // la estela se hunde hacia el fondo en el mundo (no gira con la figura)
    vec4 off = vec4(0.0, 0.0, -a * depth, 0.0);
    vec3 p = P(i, row) * scale, pp = P(i - 1.0, row) * scale, pn = P(i + 1.0, row) * scale;
    vec4 c = projectionMatrix * viewMatrix * (modelMatrix * vec4(p, 1.0) + off);
    vec4 cp = projectionMatrix * viewMatrix * (modelMatrix * vec4(pp, 1.0) + off);
    vec4 cn = projectionMatrix * viewMatrix * (modelMatrix * vec4(pn, 1.0) + off);
    vec2 d = (cn.xy / cn.w - cp.xy / cp.w) * resolution;
    vec2 dir = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
    float w = width * (1.0 - vAge * 0.55);
    c.xy += vec2(-dir.y, dir.x) * aRef.z * w / resolution * c.w;
    gl_Position = c;
    // haz lento → más brillo (tubo de rayos catódicos)
    float speed = length(pn - pp) * 0.5 / max(scale, 1e-3);
    vBright = mix(1.0, 0.06 / (0.06 + speed * 6.0), phosphor);
  }`;
const frag = /* glsl */ `
  uniform vec3 colA, colB;
  uniform float gain, rainbow, time;
  varying float vBright, vSide, vU, vAge;
  vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    float e = 1.0 - abs(vSide);
    float core = smoothstep(0.0, 0.7, e), hot = smoothstep(0.55, 1.0, e);
    vec3 base = mix(mix(colA, colB, vU), hue(vU * 0.8 + time * 0.05), rainbow);
    vec3 col = base * core + vec3(1.0) * hot * 0.35 * vBright;
    float fade = pow(1.0 - vAge, 2.2);
    gl_FragColor = vec4(col * vBright * fade * gain, 1.0);
  }`;

export class AtractorScene extends MusicScene {
  static id = 'atractor';
  static title = 'Atractor';
  constructor(app) {
    super(app, 'atractor', 'Atractor');
    this.L = new Float32Array(4096 + M); this.R = new Float32Array(4096 + M);
    this.head = 0; this.gainS = 1; this.tauS = 40; this.rotY = 0; this.rotTarget = 0; this.userQ = new THREE.Quaternion(); this.userW = new THREE.Vector2();
    this.modeIndex = 0; this.pulse = 0;
    this.look = { 'look.bloom': 0.65, 'look.bloomThreshold': 0.72, 'look.bloomRadius': 0.5, 'look.exposure': 1, 'fx.vineta': 0.55, 'fx.grano': 0.09, 'fx.contraste': 1.05, 'fx.saturacion': 1.05, 'fx.tinte': 0, 'fx.estela': 0 };
    this.padLabels = { title: 'Atractor', x: 'retardo τ', y: 'estela (persistencia)', programs: false };
  }

  defineParams() {
    super.defineParams();
    this.p('modo', { type: 'option', options: ['auto', ...MODES], default: 'auto', label: 'modo (auto = cambia con la sección)' });
    this.p('banda', { type: 'option', options: Object.keys(BANDS), default: 'grave', label: 'banda que se dibuja (filtro)' });
    this.p('retardoAuto', { default: true, label: 'τ automático (un cuarto del período dominante)' });
    this.p('retardo', { min: 0.05, max: 8, default: 1.2, step: 0.01, label: 'τ manual (ms)' });
    this.p('muestras', { min: 128, max: M, default: 900, step: 1, label: 'muestras por curva' });
    this.p('estela', { min: 2, max: K, default: 12, step: 1, label: 'curvas de estela' });
    this.p('profundidad', { min: 0, max: 0.6, default: 0.16, step: 0.005, label: 'profundidad de la estela' });
    this.p('grosor', { min: 0.5, max: 10, default: 2.2, step: 0.1, label: 'grosor del haz (px)' });
    this.p('fosforo', { min: 0, max: 1, default: 0.75, step: 0.01, label: 'fósforo (haz lento brilla más)' });
    this.p('escala', { min: 0.3, max: 8, default: 3.6, step: 0.01, label: 'escala' });
    this.p('color', { type: 'option', options: ['fósforo', 'sección', 'arcoíris'], default: 'sección', label: 'color' });
    this.p('reticula', { min: 0, max: 1, default: 0.45, step: 0.01, label: 'retícula' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x010302);
    this.data = new Float32Array(M * K * 4);
    this.tex = new THREE.DataTexture(this.data, M, K, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter; this.tex.needsUpdate = true;

    // cinta: K curvas × M puntos × 2 lados
    const ref = new Float32Array(K * M * 2 * 3), idx = [];
    let v = 0;
    for (let a = 0; a < K; a++) for (let i = 0; i < M; i++) for (const side of [-1, 1]) { ref[v * 3] = i; ref[v * 3 + 1] = a; ref[v * 3 + 2] = side; v++; }
    for (let a = 0; a < K; a++) for (let i = 0; i < M - 1; i++) { const b = (a * M + i) * 2; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 3));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(K * M * 2 * 3), 3));
    geo.setIndex(idx);
    this.U = {
      tCurve: { value: this.tex }, head: { value: 0 }, depth: { value: 0.16 }, width: { value: 2.6 }, scale: { value: 1 }, phosphor: { value: 0.75 }, count: { value: 900 },
      resolution: { value: new THREE.Vector2(1280, 720) }, colA: { value: new THREE.Color() }, colB: { value: new THREE.Color() }, gain: { value: 1 }, rainbow: { value: 0 }, time: { value: 0 },
    };
    this.beam = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: vert, fragmentShader: frag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    this.beam.frustumCulled = false;
    const res = new THREE.Vector2();
    this.beam.onBeforeRender = (r) => { const rt = r.getRenderTarget(); if (rt) res.set(rt.width, rt.height); else r.getDrawingBufferSize(res); this.U.resolution.value.copy(res); };
    this.fig = new THREE.Group(); this.fig.add(this.beam); s.add(this.fig);

    // retícula: cubo y grilla del fondo, como la pantalla de un osciloscopio
    const g = [];
    const R = 2.2, Z0 = -R, Z1 = R;
    for (let k = -4; k <= 4; k++) { const x = (k / 4) * R; g.push(x, -R, Z0, x, R, Z0, -R, x, Z0, R, x, Z0); }
    for (const [x, y] of [[-R, -R], [R, -R], [R, R], [-R, R]]) g.push(x, y, Z0, x, y, Z1);
    for (const z of [Z1]) g.push(-R, -R, z, R, -R, z, R, -R, z, R, R, z, R, R, z, -R, R, z, -R, R, z, -R, -R, z);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x2a6650, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fig.add(this.grid);

    this.fixed = { pos: new THREE.Vector3(0, 0.2, 9.5), look: new THREE.Vector3(0, 0, -0.6), fov: 40 };
    this.subject.radius = 3; this.subject.distance = 9.5;
  }

  // ---------- interacción ----------
  onPointerDown(x, y) { this.drag = { x, y }; }
  onPointerUp() { this.drag = null; }
  onPointerMove(x, y, buttons) { if (!this.drag || !buttons) return; this.userW.set((y - this.drag.y) * -40, (x - this.drag.x) * 40); this.drag.x = x; this.drag.y = y; }
  onWheel(d) { this.params.set('atractor.retardoAuto', false, 'ui'); this.params.set('atractor.retardo', THREE.MathUtils.clamp(this.v('retardo') * (d > 0 ? 0.9 : 1.11), 0.05, 8), 'ui'); }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), k = this.v2('fourier.intensidad'), B = c.bands, U = this.U;
    const player = this.app.music, pad = this.app.kaoss;
    if (c.onSection && v('modo') === 'auto') this.modeIndex = (this.modeIndex + 1) % MODES.length;
    const mode = v('modo') === 'auto' ? MODES[this.modeIndex] : v('modo');
    const n = Math.round(v('muestras'));

    // τ: un cuarto del período de la nota de la melodía, o manual (o el pad)
    const sr = player?.waveform ? player.waveform(n + 4096, this.L, this.R) : 0;
    // filtro: sólo la banda elegida (si no, la mezcla completa es un garabato)
    const [lo, hi] = BANDS[v('banda')], NN = n + 4096;
    if (sr) for (const X of [this.L, this.R]) { if (lo > 0) { biquad(X, NN, 'hp', lo, sr); biquad(X, NN, 'hp', lo, sr); } biquad(X, NN, 'lp', hi, sr); biquad(X, NN, 'lp', hi, sr); }
    // τ: un cuarto del período dominante (cruces por cero de la banda), manual o con el pad
    let tauMs = v('retardo');
    if (pad?.active) tauMs = 0.05 + pad.x * pad.x * 6;
    else if (v('retardoAuto') && sr) {
      let zc = 0, first = -1, last = -1;
      for (let i = 4097; i < NN; i++) if (this.L[i - 1] < 0 && this.L[i] >= 0) { zc++; if (first < 0) first = i; last = i; }
      if (zc >= 2) tauMs = ((last - first) / (zc - 1) / sr) * 1000 / 4;
    }
    const tau = THREE.MathUtils.clamp((tauMs / 1000) * (sr || 44100), 1, 2000);
    this.tauS += (tau - this.tauS) * (1 - Math.exp(-dt * 6));
    const T = Math.round(this.tauS), base = 4096;   // waveform(n + 4096): las n más nuevas empiezan en 4096 (antes queda margen para τ)

    // sin continua (si no, la figura se corre del centro) y ganancia automática (RMS), suavizada
    for (const X of [this.L, this.R]) { let m = 0; for (let i = base - 2 * T; i < base + n; i++) m += X[i]; m /= n + 2 * T; for (let i = base - 2 * T; i < base + n; i++) X[i] -= m; }
    let rms = 0; for (let i = 0; i < n; i++) { const x = this.L[base + i]; rms += x * x; }
    rms = Math.sqrt(rms / Math.max(1, n));
    this.gainS += (1 / (rms * 3 + 0.03) - this.gainS) * (1 - Math.exp(-dt * 4));

    // curva nueva → fila `head` de la textura (con ganancia y limitador suave: un golpe no sale del cuadro)
    this.head = (this.head + 1) % K;
    const row = this.head * M * 4, D = this.data, Lw = this.L, Rw = this.R, g = Math.min(this.gainS, 40);
    const lim = (x) => { const y = x * g; return y / Math.sqrt(1 + y * y * 0.35); };
    for (let i = 0; i < n; i++) {
      const j = base + i, o = row + i * 4;
      if (mode === 'estéreo XY') { D[o] = lim(Lw[j]); D[o + 1] = lim(Rw[j]); D[o + 2] = lim(Lw[j - T]); }
      else if (mode === 'hélice') { D[o] = lim(Lw[j]); D[o + 1] = lim(Lw[j - T]); D[o + 2] = (i / n - 0.5) * 2.4; }
      else { D[o] = lim(Lw[j]); D[o + 1] = lim(Lw[j - T]); D[o + 2] = lim(Lw[j - 2 * T]); }
      D[o + 3] = 1;
    }
    if (!sr) for (let i = 0; i < n; i++) {   // sin audio: una curva de reposo (Lissajous lento)
      const a = (i / n) * Math.PI * 2, o = row + i * 4;
      D[o] = Math.sin(a * 3 + t) * 0.3; D[o + 1] = Math.sin(a * 2) * 0.3; D[o + 2] = Math.cos(a * 5 + t * 0.7) * 0.3;
    }
    this.tex.needsUpdate = true;

    // golpe: latido y destello; beat: paso de giro
    this.pulse = Math.max(this.pulse * Math.exp(-dt * 7), B[0].hit * k);
    if (c.onBeat) this.rotTarget += c.onDownbeat ? 0.5 : 0.18;
    this.rotY += (this.rotTarget - this.rotY) * (1 - Math.exp(-dt * 5));
    if (!this.drag) this.userW.multiplyScalar(Math.exp(-dt * 2));
    const e = new THREE.Euler(this.userW.x * dt, this.userW.y * dt, 0);
    this.userQ.premultiply(new THREE.Quaternion().setFromEuler(e));
    this.fig.quaternion.copy(this.userQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY + t * 0.05));

    // uniformes
    const sc = v('escala') * (1 + this.pulse * 0.12);
    U.head.value = this.head; U.count.value = n; U.scale.value = sc * 0.55;
    U.depth.value = v('profundidad') * (pad?.active ? 0.3 + pad.y * 2 : 1); U.width.value = v('grosor') * (1 + this.pulse * 0.4);
    U.phosphor.value = v('fosforo'); U.time.value = t; U.gain.value = 1 + this.pulse * 0.8;
    const col = v('color'), sec = c.section?.type ?? 0;
    if (col === 'fósforo') { U.colA.value.setRGB(0.25, 1, 0.45); U.colB.value.setRGB(0.4, 1, 0.6); U.rainbow.value = 0; }
    else if (col === 'sección') { U.colA.value.copy(this.sectionColor(sec, 0.55)); U.colB.value.copy(this.sectionColor(sec + 2, 0.6)); U.rainbow.value = 0; }
    else U.rainbow.value = 1;
    // estela: las filas más viejas que `estela` no se dibujan (se apagan con la edad)
    this.beam.geometry.setDrawRange(0, Math.round(v('estela')) * (M - 1) * 6);
    this.grid.material.opacity = v('reticula') * (0.3 + this.pulse * 0.5);
    this.grid.scale.setScalar(Math.max(0.6, Math.min(2, sc / 1.6)));
    this.finish(dt);
  }
}
