import * as THREE from 'three';
import { MusicScene } from './MusicScene.js';

/**
 * CORDILLERA: líneas apiladas como la tapa de "Unknown Pleasures" (el
 * púlsar CP 1919), pero hechas de la música y en profundidad. Cada línea es
 * el timbre del tema en un instante (24 bandas, del grave al aire): el centro
 * es el grave, los bordes el agudo (o de izquierda a derecha). Los golpes
 * levantan picos: el bombo en el centro, la caja a los costados, los
 * platillos serrucho en los bordes.
 *
 * Tiempo en profundidad, como en todas las escenas de la categoría: lo que
 * viene está adelante (se ve venir, más tenue), el ahora brilla en el plano
 * del mural y el pasado se aleja hacia el horizonte. Las líneas de adelante
 * tapan a las de atrás (líneas ocultas, como en el dibujo original). Los
 * cambios de sección llegan como una línea de color; cada compás, una más
 * marcada.
 *
 * Pad Kaoss: X = altura de las montañas, Y = cuánto futuro se ve.
 */
const C = 160, R = 220;

const terrainVert = /* glsl */ `
  uniform sampler2D tPos;
  attribute vec2 aRC;
  varying float vFogDepth;
  void main() {
    vec3 p = texelFetch(tPos, ivec2(int(aRC.x), int(aRC.y)), 0).xyz;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const terrainFrag = /* glsl */ `
  uniform vec3 bg;
  void main() { gl_FragColor = vec4(bg, 1.0); }`;

const lineVert = /* glsl */ `
  uniform sampler2D tPos, tCol;
  uniform vec2 resolution;
  uniform float width, lift;
  attribute vec3 aRef;
  varying vec3 vCol; varying float vSide, vFog;
  vec3 P(float c, float r) { return texelFetch(tPos, ivec2(int(clamp(c, 0.0, ${C - 1}.0)), int(r)), 0).xyz + vec3(0.0, lift, 0.0); }
  void main() {
    float c = aRef.x, r = aRef.y; vSide = aRef.z;
    vec4 rc = texelFetch(tCol, ivec2(int(r), 0), 0);
    vCol = rc.rgb;
    vec4 a = projectionMatrix * modelViewMatrix * vec4(P(c, r), 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(P(c - 1.0, r), 1.0);
    vec4 d = projectionMatrix * modelViewMatrix * vec4(P(c + 1.0, r), 1.0);
    vec2 dir = (d.xy / d.w - b.xy / b.w) * resolution;
    dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);
    float w = width * rc.a * clamp(14.0 / a.w, 0.5, 1.8);
    a.xy += vec2(-dir.y, dir.x) * aRef.z * w / resolution * a.w;
    a.z -= 0.0004 * a.w;   // apenas adelante de su propio terreno
    gl_Position = a;
    vFog = a.w;
  }`;
const lineFrag = /* glsl */ `
  uniform vec3 bg; uniform float fogNear, fogFar;
  varying vec3 vCol; varying float vSide, vFog;
  void main() {
    float e = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    float f = smoothstep(fogNear, fogFar, vFog);
    gl_FragColor = vec4(mix(vCol * e, bg, f), 1.0);
  }`;

const _c = new THREE.Color();
const hash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class CordilleraScene extends MusicScene {
  static id = 'cordillera';
  static title = 'Cordillera';
  constructor(app) {
    super(app, 'cordillera', 'Cordillera');
    this.hist = new Float32Array(R * 24); this.histT = new Float32Array(R).fill(-1e9); this.histW = 0;   // historia en vivo
    this.look = { 'look.bloom': 0.45, 'look.bloomThreshold': 0.85, 'look.bloomRadius': 0.35, 'look.exposure': 1, 'fx.vineta': 0.45, 'fx.grano': 0.1, 'fx.contraste': 1.1, 'fx.saturacion': 1, 'fx.tinte': 0 };
    this.padLabels = { title: 'Cordillera', x: 'altura de las montañas', y: 'cuánto futuro se ve', programs: false };
  }

  defineParams() {
    super.defineParams();
    this.p('altura', { min: 0, max: 6, default: 2.9, step: 0.01, label: 'altura de las montañas' });
    this.p('ancho', { min: 4, max: 30, default: 21, step: 0.1, label: 'ancho' });
    this.p('futuro', { min: 0, max: 6, default: 1.2, step: 0.05, label: 'segundos de futuro que se ven venir' });
    this.p('separacion', { min: 0.02, max: 0.3, default: 0.09, step: 0.001, label: 'segundos por línea' });
    this.p('filas', { min: 20, max: R, default: 84, step: 1, label: 'líneas' });
    this.p('paso', { min: 0.1, max: 1, default: 0.42, step: 0.01, label: 'distancia entre líneas' });
    this.p('simetrico', { default: true, label: 'simétrico (grave al centro)' });
    this.p('picos', { min: 0, max: 3, default: 1, step: 0.01, label: 'picos de los golpes' });
    this.p('grosor', { min: 0.5, max: 6, default: 1.7, step: 0.05, label: 'grosor de línea (px)' });
    this.p('color', { type: 'option', options: ['blanco', 'sección', 'espectro'], default: 'blanco', label: 'color' });
  }

  build() {
    const s = this.scene;
    this.bg = new THREE.Color(0x030304);
    s.background = this.bg;
    this.pos = new Float32Array(C * R * 4); this.col = new Float32Array(R * 4);
    this.tPos = new THREE.DataTexture(this.pos, C, R, THREE.RGBAFormat, THREE.FloatType);
    this.tCol = new THREE.DataTexture(this.col, R, 1, THREE.RGBAFormat, THREE.FloatType);
    for (const t of [this.tPos, this.tCol]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; }

    // terreno negro que tapa (líneas ocultas)
    const rc = new Float32Array(C * R * 2), idx = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { rc[(r * C + c) * 2] = c; rc[(r * C + c) * 2 + 1] = r; }
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) { const a = r * C + c; idx.push(a, a + 1, a + C, a + 1, a + C + 1, a + C); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('aRC', new THREE.BufferAttribute(rc, 2)); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(C * R * 3), 3)); tg.setIndex(idx);
    this.terrain = new THREE.Mesh(tg, new THREE.ShaderMaterial({ uniforms: { tPos: { value: this.tPos }, bg: { value: this.bg } }, vertexShader: terrainVert, fragmentShader: terrainFrag, side: THREE.DoubleSide }));
    this.terrain.frustumCulled = false; s.add(this.terrain);

    // líneas: una cinta por fila
    const ref = new Float32Array(C * R * 2 * 3), li = [];
    let v = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) for (const side of [-1, 1]) { ref[v * 3] = c; ref[v * 3 + 1] = r; ref[v * 3 + 2] = side; v++; }
    for (let r = 0; r < R; r++) for (let c = 0; c < C - 1; c++) { const b = (r * C + c) * 2; li.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('aRef', new THREE.BufferAttribute(ref, 3)); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(C * R * 2 * 3), 3)); lg.setIndex(li);
    this.LU = { tPos: { value: this.tPos }, tCol: { value: this.tCol }, resolution: { value: new THREE.Vector2(1280, 720) }, width: { value: 1.7 }, lift: { value: 0.01 }, bg: { value: this.bg }, fogNear: { value: 40 }, fogFar: { value: 75 } };
    this.lines = new THREE.Mesh(lg, new THREE.ShaderMaterial({ uniforms: this.LU, vertexShader: lineVert, fragmentShader: lineFrag, side: THREE.DoubleSide, depthWrite: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 2;
    const res = new THREE.Vector2();
    this.lines.onBeforeRender = (r) => { const rt = r.getRenderTarget(); if (rt) res.set(rt.width, rt.height); else r.getDrawingBufferSize(res); this.LU.resolution.value.copy(res); };
    s.add(this.lines);

    // lente larga: casi ortográfica, las líneas quedan parejas como en el dibujo original
    this.fixed = { pos: new THREE.Vector3(0, 13.5, 24), look: new THREE.Vector3(0, -1, -11), fov: 34 };
    this.subject.radius = 10; this.subject.distance = 36;
  }

  /** Timbre (24 bandas) en el instante t: del análisis, o de la historia en vivo. */
  timbreAt(c, t, out) {
    const A = c.A;
    if (A?.timbre) {
      const n = A.timbre.length / 24, f = THREE.MathUtils.clamp(t * 100, 0, n - 1.001), f0 = Math.floor(f), k = f - f0;
      for (let i = 0; i < 24; i++) out[i] = A.timbre[f0 * 24 + i] * (1 - k) + A.timbre[(f0 + 1) * 24 + i] * k;
      return true;
    }
    // en vivo: la fila más cercana de la historia (el futuro no existe todavía)
    if (t > c.t + 1e-3) return false;
    let best = -1, bd = 1e9;
    for (let j = 0; j < R; j++) { const d = Math.abs(this.histT[j] - t); if (d < bd) { bd = d; best = j; } }
    if (best < 0 || bd > 0.2) return false;
    for (let i = 0; i < 24; i++) out[i] = this.hist[best * 24 + i];
    return true;
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), k = this.v2('fourier.intensidad'), pad = this.app.kaoss;
    // en vivo: guardar el timbre del ahora
    if (!c.A) { this.histT[this.histW] = c.t; this.hist.set(c.timbre, this.histW * 24); this.histW = (this.histW + 1) % R; }

    const dtRow = v('separacion'), W = v('ancho'), sym = v('simetrico'), peaks = v('picos') * k, dz = v('paso'), rows = Math.round(v('filas'));
    let amp = v('altura') * (0.7 + 0.3 * k), ahead = v('futuro');
    if (pad?.active) { amp = pad.x * 4.5; ahead = 0.2 + pad.y * 6; }
    const now = c.t, rowNow = Math.floor(now / dtRow), futureRows = Math.min(rows - 10, Math.round(ahead / dtRow));
    const tim = new Float32Array(24), colMode = v('color');
    const P = this.pos, Cc = this.col;
    const beatSet = new Set(), downSet = new Set();
    for (const b of c.beatsBetween(now - (rows - futureRows) * dtRow, now + futureRows * dtRow)) { const rr = Math.round(b.t / dtRow); beatSet.add(rr); if (b.downbeat) downSet.add(rr); }
    // golpes por fila (bombo, caja, platillos)
    const hits = [0, 2, 4].map((band) => { const m = new Map(); for (const o of c.onsetsBetween(band, now - (rows - futureRows) * dtRow, now + futureRows * dtRow)) { const rr = Math.round(o.t / dtRow); m.set(rr, Math.max(m.get(rr) ?? 0, o.s)); } return m; });

    for (let r = 0; r < rows; r++) {
      const rowIdx = rowNow + futureRows - r;                 // r = 0: lo más lejano del futuro (adelante)
      const tr = rowIdx * dtRow, z = ((tr - now) / dtRow) * dz;
      const has = this.timbreAt(c, tr, tim);
      const kk = hits[0].get(rowIdx) ?? 0, sn = hits[1].get(rowIdx) ?? 0, hh = hits[2].get(rowIdx) ?? 0;
      for (let col = 0; col < C; col++) {
        const x = col / (C - 1) * 2 - 1;                       // -1..1
        const u = sym ? Math.abs(x) : (x + 1) / 2;             // 0 = grave
        const bf = u * 23, b0 = Math.floor(bf), fr = bf - b0;
        // Catmull-Rom entre bandas
        const p0 = tim[Math.max(0, b0 - 1)], p1 = tim[b0], p2 = tim[Math.min(23, b0 + 1)], p3 = tim[Math.min(23, b0 + 2)];
        let h = has ? 0.5 * (2 * p1 + (-p0 + p2) * fr + (2 * p0 - 5 * p1 + 4 * p2 - p3) * fr * fr + (-p0 + 3 * p1 - 3 * p2 + p3) * fr * fr * fr) : 0;
        const env = 0.18 + 0.82 * Math.exp(-x * x * 2.2);
        h = Math.max(0, h) * env * amp;
        // picos: bombo al centro, caja a los costados, platillos serrucho en los bordes
        h += kk * peaks * 1.6 * Math.exp(-(x * x) / 0.004);
        h += sn * peaks * 0.9 * (Math.exp(-((x - 0.38) ** 2) / 0.003) + Math.exp(-((x + 0.38) ** 2) / 0.003));
        if (hh > 0 && Math.abs(x) > 0.55) h += hh * peaks * 0.35 * hash(col * 3.7 + rowIdx * 1.3);
        h += 0.012 * hash(col * 0.91 + rowIdx * 7.3);
        const o = (r * C + col) * 4;
        P[o] = x * W / 2; P[o + 1] = h; P[o + 2] = z; P[o + 3] = 1;
      }
      // color y grosor de la fila
      const age = (now - tr) / Math.max(0.2, c.beatDur);       // beats (negativo = futuro)
      let I = age < 0 ? 0.42 : 1, wid = 1;
      if (Math.abs(age) < 0.5 * dtRow / Math.max(0.2, c.beatDur) + 0.04) { I = 2.4; wid = 1.8; }   // el ahora
      if (beatSet.has(rowIdx)) { I *= 1.35; wid *= 1.25; }
      if (downSet.has(rowIdx)) { I *= 1.25; wid *= 1.35; }
      const S = c.sectionAt ? c.sectionAt(tr) : null;
      const secStart = S && Math.abs(S.t0 - tr) < dtRow * 0.5;
      if (colMode === 'blanco') _c.setRGB(1, 0.98, 0.95);
      else if (colMode === 'sección') _c.copy(this.sectionColor(S?.type ?? 0, 0.65));
      else _c.setHSL(((r / R) * 0.8 + t * 0.02) % 1, 0.8, 0.6);
      if (secStart) { _c.copy(this.sectionColor(S.type, 0.6)); I = 2; wid = 2.2; }
      if (!has) I *= 0.25;
      _c.multiplyScalar(I);
      Cc[r * 4] = _c.r; Cc[r * 4 + 1] = _c.g; Cc[r * 4 + 2] = _c.b; Cc[r * 4 + 3] = wid;
    }
    this.tPos.needsUpdate = true; this.tCol.needsUpdate = true;
    this.terrain.geometry.setDrawRange(0, (rows - 1) * (C - 1) * 6); this.lines.geometry.setDrawRange(0, rows * (C - 1) * 6);
    this.LU.width.value = v('grosor');
    this.finish(dt);
  }
}
