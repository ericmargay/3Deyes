import * as THREE from 'three';
import { MusicScene } from './MusicScene.js';
import { KALEIDO_MODES, makeChamber, randomInChamber, chamberPoint, nearestEdgePoint, unapply, inside } from '../../sim/Kaleido.js';
import { makeKinds } from './kaleido/objects.js';

/**
 * CALEIDOSCOPIO: un caleidoscopio de verdad. Los espejos son paralelos al eje
 * de la vista, como en el tubo: con 2 espejos se forma una roseta (y un túnel
 * hacia el fondo), con 3 o 4 el dibujo se repite hasta llenar el mural
 * (triángulo equilátero, escuadra, cartabón, cuadrado). Cada reflejo se ve
 * sólo a través de su espejo, así las costuras quedan nítidas, y como z no
 * cambia en los reflejos el estéreo de todas las copias es exacto. Hasta los
 * brillos son simétricos: la luz se calcula en la cámara de espejos.
 *
 * En la cámara hay objetos de caleidoscopio (gemas talladas, cristales,
 * esquirlas, pétalos, estrellas y flores de lentejuela, cuentas, perlas,
 * tubos, anillos, purpurina, agujas) y atrás un fondo que también se refleja
 * (campo de color con líneas de nivel de neón, vitral, mosaico).
 *
 * Sincronía: cada objeto se programa con el análisis del tema para aterrizar
 * exactamente en su golpe o su nota. Nace de una costura del espejo (se abre
 * junto con su reflejo, como en el tubo), viaja y llega en el instante justo;
 * ahí destella y se asienta.
 *   notas      una pieza por nota: el registro elige la pieza (grave: gemas,
 *              medio: pétalos y esquirlas, agudo: cristales y cuentas), la
 *              altura la ubica (grave cerca del centro) y el color sale del
 *              círculo de quintas dentro de la paleta
 *   bombo      flor en el centro de los espejos + anillo que se abre
 *   bajo       gema · caja: estrella · agudos: cristal · platillos: purpurina
 *   compás     agujas de oro sobre las costuras de los espejos
 *   beat       el tubo gira un paso
 *   sección    cambian los espejos, la paleta (y el estilo, en auto)
 * Con un DAW: las notas MIDI (Ableton → IAC) crean piezas en el acto; el
 * canal de batería (10 por defecto) usa el mapa GM: 36 bombo, 38 caja, 42 hats.
 *
 * Interacción: arrastrar gira el tubo, rueda cambia los espejos, clic suelta
 * piezas ahí. Pad Kaoss: X = espejos, Y = zoom.
 */
const KINDS = makeKinds();
const KIND_NAMES = Object.keys(KINDS);
const MAXK = 64;                 // objetos por tipo
const MAXC = 512;                // copias (reflejos)
const PITCH_POS = (midi) => ((midi % 12) * 7 % 12) / 12;   // círculo de quintas
const PALETTES = {
  'arcoíris': ['#ff2bd6', '#6a3bff', '#00c8ff', '#3dff6e', '#ffd23d'],
  nocturno: ['#4b1fd1', '#2f6bff', '#ff4f7b', '#ff9a3d', '#b03cff'],
  coral: ['#ff5a5f', '#0f8b8d', '#f3e3c3', '#ff9f80', '#2ec4b6'],
  'ácido': ['#1d3bff', '#16e05a', '#ff2a2a', '#9b30ff', '#00e1ff'],
  pastel: ['#ff4fa0', '#33c3f0', '#9be15d', '#a259ff', '#ffb02e'],
};
const PAL_NAMES = Object.keys(PALETTES);
const STYLES = ['joyas', 'neón', 'vitral', 'mosaico'];
const AUTO_MODES = [['roseta', 6], ['equilátero', 0], ['roseta', 8], ['cartabón', 0], ['roseta', 12], ['escuadra', 0], ['roseta', 5], ['cuadrado', 0]];
const PAD_MODES = [['roseta', 4], ['roseta', 6], ['roseta', 8], ['roseta', 12], ['equilátero', 0], ['escuadra', 0], ['cartabón', 0], ['cuadrado', 0]];
const SIZE_K = { 'equilátero': 1, escuadra: 0.93, 'cartabón': 1.22, cuadrado: 0.66 };   // misma superficie por cámara
const BAND_THR = [1, 1.4, 1, 1, 1.2];   // umbral relativo por banda (el bajo dispara mucho)
const LOOKS = {
  joyas: { 'look.bloom': 0.75, 'look.bloomThreshold': 0.78, 'look.bloomRadius': 0.5 },
  'neón': { 'look.bloom': 0.55, 'look.bloomThreshold': 0.72, 'look.bloomRadius': 0.45 },
  vitral: { 'look.bloom': 0.12, 'look.bloomThreshold': 0.97, 'look.bloomRadius': 0.3 },
  mosaico: { 'look.bloom': 0.3, 'look.bloomThreshold': 0.9, 'look.bloomRadius': 0.4 },
};
const ease = { out3: (x) => 1 - Math.pow(1 - x, 3), in2: (x) => x * x, smooth: (x) => x * x * (3 - 2 * x) };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

// ---------- shaders ----------
const vert = /* glsl */ `
  uniform sampler2D tObj, tCopy;
  uniform float nCopies, zoom;
  uniform mat2 tube;
  attribute vec3 bary;
  varying vec3 vPc, vNc, vBary;
  varying vec4 vCol, vMat;
  flat varying vec3 vCam;
  void main() {
    int nc = int(nCopies), obj = gl_InstanceID / nc, cp = gl_InstanceID - obj * nc;
    vec4 m0 = texelFetch(tObj, ivec2(obj, 0), 0), m1 = texelFetch(tObj, ivec2(obj, 1), 0), m2 = texelFetch(tObj, ivec2(obj, 2), 0);
    vCol = texelFetch(tObj, ivec2(obj, 3), 0); vMat = texelFetch(tObj, ivec2(obj, 4), 0);
    vec4 cA = texelFetch(tCopy, ivec2(cp, 0), 0), cB = texelFetch(tCopy, ivec2(cp, 1), 0);
    vec3 p = position, n = normal;
    if (cB.z < 0.0) { p.x = -p.x; n.x = -n.x; }   // espejo local (la forma es simétrica en x): las caras no se invierten
    vec3 pc = vec3(dot(m0.xyz, p) + m0.w, dot(m1.xyz, p) + m1.w, dot(m2.xyz, p) + m2.w);
    vPc = pc; vNc = vec3(dot(m0.xyz, n), dot(m1.xyz, n), dot(m2.xyz, n)); vBary = bary;
    mat2 A = mat2(cA.x, cA.y, cA.z, cA.w);
    vec3 w = vec3(tube * (A * pc.xy + cB.xy), pc.z) * zoom;
    // el observador llevado a la cámara de espejos: los reflejos (y sus brillos) son exactos
    vec3 cl = cameraPosition / zoom;
    vCam = vec3(transpose(A) * (transpose(tube) * cl.xy - cB.xy), cl.z);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(w, 1.0);
  }`;

const clipChunk = /* glsl */ `
  uniform vec3 dom[4];
  uniform int domN;
  uniform float clipOn;
  bool outside(vec2 p) {
    if (clipOn < 0.5) return false;
    for (int i = 0; i < 4; i++) { if (i >= domN) break; if (dot(dom[i].xy, p) + dom[i].z < -0.004) return true; }
    return false;
  }`;

const objFrag = /* glsl */ `
  uniform int style;
  uniform float gain, edgeK, glassK, metalK, roughK, iridK, time;
  uniform vec3 boxDir[4], boxCol[4], skyA, skyB;
  varying vec3 vPc, vNc, vBary;
  varying vec4 vCol, vMat;
  flat varying vec3 vCam;
  ${clipChunk}
  vec3 spectrum(float x) { return clamp(abs(fract(x + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
  // entorno analítico (cajas de luz) en la cámara de espejos
  vec3 env(vec3 d, float r) {
    vec3 c = mix(skyB, skyA, d.y * 0.5 + 0.5) * 0.3;
    for (int i = 0; i < 4; i++) {
      float k = dot(d, boxDir[i]), w = mix(0.986, 0.8, r);
      c += boxCol[i] * smoothstep(w - 0.025 - r * 0.15, w + 0.008, k);
    }
    return c;
  }
  void main() {
    if (outside(vPc.xy)) discard;
    float fade = vCol.a; if (fade < 0.004) discard;
    vec3 base = vCol.rgb, N = normalize(vNc), V = normalize(vCam - vPc);
    if (dot(N, V) < 0.0) N = -N;
    float ndv = clamp(dot(N, V), 0.0, 1.0), f = pow(1.0 - ndv, 3.0);
    vec3 bw = max(fwidth(vBary), vec3(1e-5)), e3 = smoothstep(vec3(0.0), bw * 1.4, vBary);
    float edge = (1.0 - min(min(e3.x, e3.y), e3.z)) * edgeK;
    float glow = vMat.x, flash = vMat.y;
    vec3 col;
    if (style == 1) {            // neón (se suma)
      col = min(base * (0.015 + 0.22 * f + 1.0 * edge) * (1.0 + 0.5 * flash) * fade * gain, vec3(1.3));   // contornos de neón
    } else if (style == 2) {     // vitral (filtro que multiplica: los vidrios se mezclan restando)
      float k = clamp((0.6 + 0.25 * f + 0.3 * edge) * fade, 0.0, 1.0);
      col = mix(vec3(1.0), mix(base, vec3(1.0), 0.12) * (1.0 - 0.35 * edge), k);
    } else if (style == 3) {     // mosaico (facetas planas)
      vec3 L = normalize(vec3(0.35, 0.6, 0.72));
      col = (base * (0.42 + 0.58 * max(dot(N, L), 0.0)) + pow(max(dot(reflect(-L, N), V), 0.0), 30.0) * 0.25 + base * flash) * gain;
    } else {                     // joyas: vidrio, metal y película fina
      vec3 F0 = mix(vec3(0.04), base, metalK);
      vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
      vec3 R = reflect(-V, N), T = refract(-V, N, 0.66);
      vec3 spec = env(R, roughK) * F;
      vec3 thin = spectrum(ndv * 1.8 + vMat.w * 0.37 + time * 0.03);
      spec *= mix(vec3(1.0), thin * 1.7, iridK);
      vec3 trans = env(T, roughK + 0.25) * base * base * glassK * 1.3;   // vidrio de color: la luz que pasa se tiñe
      vec3 irr = mix(skyB, skyA, N.y * 0.5 + 0.5) * 0.45;
      for (int i = 0; i < 4; i++) irr += boxCol[i] * max(dot(N, boxDir[i]), 0.0) * 0.12;
      vec3 diff = base * irr * (1.0 - glassK) * (1.0 - metalK);
      col = (diff + trans * (1.0 - F) + spec + base * (0.12 + glow + flash * 1.3) + base * edge * 0.1) * gain;
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const plateFrag = /* glsl */ `
  uniform int style;
  uniform float time, flowK, linesK, plateK, seamK, seamFlash, pulse, scaleCh;
  uniform vec3 pal[5];
  varying vec3 vPc, vNc, vBary;
  varying vec4 vCol, vMat;
  flat varying vec3 vCam;
  ${clipChunk}
  float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.55; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.45; } return s; }
  vec3 palette(float x) { x = fract(x) * 5.0; int i = int(floor(x)); float t = smoothstep(0.0, 1.0, fract(x)); return mix(pal[i], pal[(i + 1) - ((i + 1) / 5) * 5], t); }
  void main() {
    if (outside(vPc.xy)) discard;
    vec2 q = vPc.xy / scaleCh;
    // costuras de los espejos
    float ds = 1e9;
    for (int i = 0; i < 4; i++) { if (i >= domN) break; ds = min(ds, abs(dot(dom[i].xy, vPc.xy) + dom[i].z)); }
    float px = max(fwidth(vPc.x) + fwidth(vPc.y), 1e-4);
    float seam = exp(-ds / (px * 0.9)), seamGlow = exp(-ds / (0.05 * scaleCh)) * 0.4;
    vec2 w = vec2(fbm(q * 0.55 + vec2(0.0, time * 0.06)), fbm(q * 0.55 + vec2(5.2, -time * 0.05)));
    float f = fbm(q * 0.75 + w * (0.8 + flowK * 1.6) + time * 0.025);
    vec3 col;
    if (style == 2) {            // vitral: luz lechosa que entra por el fondo del tubo
      col = vec3(1.0, 0.985, 0.96) * (0.88 + 0.06 * f) * plateK;
      col = mix(col, col * palette(f * 0.8 + 0.1), 0.12);
      col *= 1.0 - (seam * 0.55 + seamGlow * 0.2) * seamK;
    } else if (style == 3) {     // mosaico de triángulos
      vec2 g = q * 2.4 + w * 0.35; vec2 cell = floor(g), fr = fract(g);
      float tri = step(fr.y, fr.x);
      float hs = h21(cell * 1.31 + tri * 17.7);
      col = palette(hs + floor(f * 3.0) * 0.13) * (0.7 + 0.45 * h21(cell + tri * 3.3 + 7.0)) * plateK;
      float gap = min(min(fr.x, fr.y), min(min(1.0 - fr.x, 1.0 - fr.y), abs(fr.x - fr.y) * 0.7071));
      col *= smoothstep(0.0, 0.035, gap) * 0.75 + 0.25;
      col = mix(col, vec3(1.0), seam * 0.6 * seamK);
    } else {                     // joyas / neón: campo de color con líneas de nivel
      float bright = style == 1 ? 0.55 : 0.4;
      col = palette(f * 1.4 + time * 0.015) * (0.04 + 0.5 * smoothstep(0.38, 0.85, f)) * plateK * bright;
      float k = f * 7.0, d = abs(fract(k) - 0.5) / max(fwidth(k), 1e-4);
      col += palette(f * 1.4 + 0.33) * (1.0 - smoothstep(0.6, 2.2, d)) * linesK * (0.55 + pulse * 0.8) * bright;
      col += (seam * 1.2 + seamGlow) * seamK * mix(vec3(1.0), palette(0.05), 0.4) * (0.6 + seamFlash * 2.0);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class CaleidoscopioScene extends MusicScene {
  static id = 'caleidoscopio';
  static title = 'Caleidoscopio';
  constructor(app) {
    super(app, 'caleidoscopio', 'Caleidoscopio');
    this.objs = Object.fromEntries(KIND_NAMES.map((k) => [k, []]));
    this.spawned = new Map(); this.midiQ = [];
    this.tubeA = 0; this.tubeTarget = 0; this.zoomS = 1; this.pulse = 0; this.seamFlash = 0;
    this.modeIdx = 0; this.palIdx = 0; this.styleIdx = 0; this.switchT = null; this.padIdx = -1; this.padMode = null;
    this.lastT = 0; this.drag = null;
    this.look = { ...LOOKS.joyas, 'look.exposure': 1, 'fx.vineta': 0.42, 'fx.grano': 0.04, 'fx.contraste': 1.06, 'fx.saturacion': 1.1, 'fx.tinte': 0 };
    this.padLabels = { title: 'Caleidoscopio', x: 'espejos (roseta → teselados)', y: 'zoom', programs: false };
  }

  defineParams() {
    super.defineParams();
    this.p('espejos', { type: 'option', options: ['auto', ...KALEIDO_MODES], default: 'auto', label: 'espejos (auto = cambian con la sección)' });
    this.p('pliegues', { min: 3, max: 16, default: 6, step: 1, label: 'pliegues de la roseta' });
    this.p('estilo', { type: 'option', options: [...STYLES, 'auto'], default: 'joyas', label: 'estilo (joyas · neón · vitral · mosaico)' });
    this.p('paleta', { type: 'option', options: ['auto', ...PAL_NAMES], default: 'auto', label: 'paleta (auto = cambia con la sección)' });
    this.p('llegada', { min: 0.25, max: 4, default: 1, step: 0.05, label: 'viaje de cada pieza hasta su golpe (beats)' });
    this.p('densidad', { min: 0, max: 80, default: 28, step: 1, label: 'piezas mínimas en la cámara' });
    this.p('tamano', { min: 0.3, max: 2.5, default: 1, step: 0.01, label: 'tamaño de las piezas' });
    this.p('vida', { min: 0.3, max: 4, default: 1, step: 0.01, label: 'cuánto duran las piezas' });
    this.p('giroBeat', { min: 0, max: 90, default: 12, step: 0.5, label: 'giro del tubo por beat (grados)' });
    this.p('brillo', { min: 0, max: 3, default: 1, step: 0.01, label: 'brillo de las piezas' });
    this.p('fondo', { min: 0, max: 2, default: 1, step: 0.01, label: 'fondo reflejado' });
    this.p('lineas', { min: 0, max: 2, default: 0.8, step: 0.01, label: 'líneas de neón del fondo' });
    this.p('costuras', { min: 0, max: 2, default: 0.7, step: 0.01, label: 'costuras de los espejos' });
    this.p('recortar', { default: true, label: 'cada reflejo sólo en su espejo (caleidoscopio real)' });
    this.p('midi', { default: true, label: 'notas MIDI del DAW crean piezas' });
    this.p('canalBateria', { min: 1, max: 16, default: 10, step: 1, label: 'canal MIDI de batería (mapa GM)' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x020104);
    // texturas: transformaciones de las copias y de los objetos (una por tipo)
    this.copyData = new Float32Array(MAXC * 2 * 4);
    this.tCopy = new THREE.DataTexture(this.copyData, MAXC, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tCopy.minFilter = this.tCopy.magFilter = THREE.NearestFilter;
    this.U = {   // compartidos por todas las piezas y el fondo
      tCopy: { value: this.tCopy }, nCopies: { value: 1 }, zoom: { value: 1 }, tube: { value: new THREE.Matrix2() },
      dom: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }, domN: { value: 2 }, clipOn: { value: 1 },
      style: { value: 0 }, time: { value: 0 }, gain: { value: 1 },
      boxDir: { value: [new THREE.Vector3(0.3, 0.62, 0.72).normalize(), new THREE.Vector3(-0.85, -0.1, 0.5).normalize(), new THREE.Vector3(0.88, -0.25, 0.4).normalize(), new THREE.Vector3(-0.2, 0.35, -0.9).normalize()] },
      boxCol: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] }, skyA: { value: new THREE.Color() }, skyB: { value: new THREE.Color() },
    };
    const tex = (w, h) => { const d = new Float32Array(w * h * 4), t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; return t; };

    this.meshes = {};
    for (const name of KIND_NAMES) {
      const K = KINDS[name], t = tex(MAXK, 5);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', K.geo.attributes.position); g.setAttribute('normal', K.geo.attributes.normal); g.setAttribute('bary', K.geo.attributes.bary);
      g.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.U, tObj: { value: t }, edgeK: { value: K.edge }, glassK: { value: K.glass }, metalK: { value: K.metal }, roughK: { value: K.rough }, iridK: { value: K.irid } },
        vertexShader: vert, fragmentShader: objFrag, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 2; m.name = `piezas: ${name}`;
      s.add(m);
      this.meshes[name] = { mesh: m, tex: t, data: t.image.data };
    }
    // fondo reflejado: un plano grande en la cámara, replicado igual que las piezas
    const pt = tex(1, 5), plane = new THREE.PlaneGeometry(1, 1).toNonIndexed(), pg = new THREE.InstancedBufferGeometry();
    pg.setAttribute('position', plane.attributes.position); pg.setAttribute('normal', plane.attributes.normal);
    pg.setAttribute('bary', new THREE.BufferAttribute(new Float32Array(plane.attributes.position.count * 3), 3));
    this.PU = { tObj: { value: pt }, flowK: { value: 0.5 }, linesK: { value: 0.8 }, plateK: { value: 1 }, seamK: { value: 0.7 }, seamFlash: { value: 0 }, pulse: { value: 0 }, scaleCh: { value: 3 }, pal: { value: [0, 1, 2, 3, 4].map(() => new THREE.Color()) } };
    this.plate = new THREE.Mesh(pg, new THREE.ShaderMaterial({ uniforms: { ...this.U, ...this.PU }, vertexShader: vert, fragmentShader: plateFrag, depthWrite: false }));
    this.plate.frustumCulled = false; this.plate.renderOrder = 0; this.plate.name = 'fondo reflejado'; this.plateTex = pt;
    s.add(this.plate);

    // MIDI del DAW: cada nota es una pieza (sin anticipación: llega en el acto)
    this.app.midi?.onNote?.((e) => { if (this.built && this.v('midi')) this.midiQ.push(e); });

    this.params.onChange((id) => {
      if (id === 'caleidoscopio.espejos' || id === 'caleidoscopio.pliegues') this.requestChamber();
      if (id === 'caleidoscopio.estilo') this.applyStyle();
    });
    this.setChamber(this.currentMode(), true);
    this.applyStyle();
  }

  // ---------- espejos, estilo, paleta ----------
  currentMode() {
    if (this.padMode) return this.padMode;
    const m = this.v('espejos');
    if (m === 'auto') return AUTO_MODES[this.modeIdx % AUTO_MODES.length];
    return [m, this.v('pliegues')];
  }
  requestChamber() { const [m, n] = this.currentMode(); if (!this.chamber || m !== this.chamber.mode || (m === 'roseta' && n !== this.chamber.n)) this.switchT = { t: 0, swapped: false }; }

  setChamber([mode, n], now = false) {
    const roseta = mode === 'roseta';
    const size = roseta ? 14 : 4.2 * SIZE_K[mode];
    const ch = makeChamber(mode, { n: n || this.v('pliegues'), size, radius: roseta ? 18 : 15.5, maxCopies: MAXC });
    this.chamber = ch;
    const D = this.copyData; D.fill(0);
    ch.copies.forEach((c, i) => { D.set([c.m[0], c.m[1], c.m[2], c.m[3]], i * 4); D.set([c.t[0], c.t[1], c.det, 0], (MAXC + i) * 4); });
    this.tCopy.needsUpdate = true;
    this.U.nCopies.value = ch.copies.length;
    ch.half.forEach(([a, b, c], i) => this.U.dom.value[i].set(a, b, c));
    this.U.domN.value = ch.half.length;
    // fondo: un plano que cubre la cámara (en la roseta, al fondo del túnel)
    const P = this.plateTex.image.data;
    let cx, cy, w, h, z;
    if (roseta) { cx = 0; cy = 0; w = h = 140; z = -28; } else {
      const xs = ch.poly.map((p) => p.x), ys = ch.poly.map((p) => p.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      w = Math.max(...xs) - Math.min(...xs) + 0.6; h = Math.max(...ys) - Math.min(...ys) + 0.6; z = -0.45;
    }
    P.set([w, 0, 0, cx, 0, h, 0, cy, 0, 0, 1, z, 1, 1, 1, 1, 0, 0, 0, 0]);
    this.plateTex.needsUpdate = true;
    this.plate.geometry.instanceCount = ch.copies.length;
    this.PU.scaleCh.value = roseta ? 4 : ch.size;
    // cámara: túnel profundo para la roseta, casi ortográfica para los teselados (las costuras se alinean)
    this.fixed = roseta ? { pos: new THREE.Vector3(0, 0, 15), look: new THREE.Vector3(0, 0, 0), fov: 52 } : { pos: new THREE.Vector3(0, 0, 26), look: new THREE.Vector3(0, 0, 0), fov: 30 };
    this.subject.distance = this.fixed.pos.z;
    // las piezas vivas se reubican adentro de la cámara nueva
    if (!now) for (const k of KIND_NAMES) for (const o of this.objs[k]) { const p = randomInChamber(ch); o.target.set(p.x, p.y, o.target.z); o.start.copy(o.target); }
  }

  get style() { const s = this.v('estilo'); return s === 'auto' ? STYLES[this.styleIdx % STYLES.length] : s; }

  applyStyle() {
    const st = this.style;
    this.U.style.value = STYLES.indexOf(st);
    for (const k of KIND_NAMES) {
      const m = this.meshes[k].mesh.material;
      m.transparent = st === 'neón' || st === 'vitral';
      m.depthWrite = !m.transparent;
      // neón: gana el más brillante (no se acumula hasta el blanco) · vitral: el mínimo por canal
      // (amarillo sobre cian da verde, como vidrios de color, sin llegar al negro)
      if (st === 'neón' || st === 'vitral') { m.blending = THREE.CustomBlending; m.blendEquation = st === 'neón' ? THREE.MaxEquation : THREE.MinEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; }
      else m.blending = THREE.NormalBlending;
      m.needsUpdate = true;
    }
    this.look = { ...this.look, ...LOOKS[st] };
    if (this.built && this.params.get('fourier.lookEscena') !== false) for (const [id, v] of Object.entries(LOOKS[st])) this.params.set(id, v, 'scene');
  }

  palette() { const p = this.v('paleta'); return PALETTES[p === 'auto' ? PAL_NAMES[this.palIdx % PAL_NAMES.length] : p]; }
  palColor(i, out = new THREE.Color()) { const P = this.palette(); return out.set(P[((Math.floor(i) % P.length) + P.length) % P.length]); }
  /** Color continuo a lo largo de la paleta (x en 0..1). */
  palAt(x, out = new THREE.Color()) {
    const P = this.palette(), f = (((x % 1) + 1) % 1) * P.length, i = Math.floor(f);
    return out.set(P[i]).lerp(_c.set(P[(i + 1) % P.length]), ease.smooth(f - i));
  }

  // ---------- piezas ----------
  /**
   * Programa una pieza que aterriza en `te` (segundos del tema). Nace en la costura
   * del espejo más cercana y se abre junto con su reflejo.
   */
  spawn(kind, te, pos, { size = 1, color, life = 2, spin = 1, grow = 0, glow = 0.12, flat = false, travel } = {}) {
    const list = this.objs[kind]; if (!list) return null;
    if (list.length >= MAXK) { list.sort((a, b) => a.te - b.te); list.shift(); }
    const now = this.cues.t, T = travel ?? Math.max(0.15, this.v('llegada') * this.cues.beatDur);
    const ch = this.chamber, roseta = ch.mode === 'roseta';
    const target = new THREE.Vector3(pos.x, pos.y, roseta ? -Math.random() * 1.2 : (Math.random() - 0.5) * 0.3);
    const e = nearestEdgePoint(ch, new THREE.Vector2(pos.x, pos.y));
    const out = new THREE.Vector2(pos.x - e.x, pos.y - e.y), L = out.length() || 1;
    const start = new THREE.Vector3(e.x - (out.x / L) * size * 0.6, e.y - (out.y / L) * size * 0.6, roseta ? 5 : 2.2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(flat ? 0 : (Math.random() - 0.5) * 1.2, flat ? 0 : (Math.random() - 0.5) * 1.2, Math.random() * Math.PI * 2));
    const o = { kind, te, ts: Math.max(Math.min(now, te - 0.05), te - T), start, target, q, spin: new THREE.Vector3().randomDirection().multiplyScalar(spin), size: size * this.v('tamano'), color: color.clone(), life: life * this.v('vida'), grow, glow, seed: Math.random() * 10 };
    list.push(o);
    return o;
  }

  schedule(key, te, make) { if (this.spawned.has(key)) return; this.spawned.set(key, te); make(te); }

  kindForNote(midi) { return midi < 48 ? 'gema' : midi < 60 ? 'petalo' : midi < 72 ? 'esquirla' : midi < 84 ? 'cristal' : 'cuenta'; }

  noteObject(midi, vel, te, dur = 0.5) {
    const ch = this.chamber, u = THREE.MathUtils.clamp((midi - 36) / 60, 0, 1), v = PITCH_POS(midi);
    const p = chamberPoint(ch, u * 0.85 + Math.random() * 0.1, (v + (Math.random() - 0.5) * 0.06 + 1) % 1);
    const kind = this.kindForNote(midi), sc = (ch.mode === 'roseta' ? 0.9 : 0.55) * (0.6 + 0.6 * vel) * (kind === 'gema' ? 1.25 : 1);
    return this.spawn(kind, te, p, { size: sc, color: this.palAt(v + 0.02 * (Math.random() - 0.5)), life: dur + 2 * this.cues.beatDur, glow: 0.1 + vel * 0.15 });
  }

  bandObject(band, s, te) {
    const ch = this.chamber, roseta = ch.mode === 'roseta', k = roseta ? 1 : 0.6, beat = this.cues.beatDur;
    const col = this.palColor(band);
    if (band === 0) {                    // bombo: flor en el centro de los espejos + anillo que se abre
      const c = ch.centers[0];
      this.spawn('flor', te, c, { size: (roseta ? 1.3 : 1.0) * (0.7 + 0.5 * s), color: col, life: 1.5 * beat, spin: 0.4, flat: true, glow: 0.1 });
      this.spawn('anillo', te, c, { size: roseta ? 1.1 : 0.8, color: this.palColor(band + 2), life: 1.2 * beat, spin: 0, grow: roseta ? 3 : 2.2, flat: true, glow: 0.2 });
    } else if (band === 1) this.spawn('gema', te, chamberPoint(ch, 0.05 + Math.random() * 0.3, Math.random()), { size: 0.85 * k * (0.7 + 0.5 * s), color: col, life: 2 * beat });
    else if (band === 2) this.spawn('estrella', te, randomInChamber(ch), { size: 0.7 * k * (0.7 + 0.5 * s), color: col, life: 1.5 * beat, flat: true, glow: 0.25 });
    else if (band === 3) this.spawn('cristal', te, chamberPoint(ch, 0.4 + Math.random() * 0.6, Math.random()), { size: 0.55 * k, color: col, life: 1.2 * beat });
    else for (let i = 0; i < 3; i++) this.spawn('brillo', te, randomInChamber(ch), { size: 0.16 * k, color: _c.setRGB(1, 0.95, 0.85), life: 0.45, spin: 8, travel: 0.4 * beat });
  }

  downbeatObjects(te) {
    const ch = this.chamber, P = ch.poly, col = this.palColor(3), roseta = ch.mode === 'roseta';
    const edges = roseta ? [[P[0], P[1]], [P[0], P[2]]] : P.map((A, i) => [A, P[(i + 1) % P.length]]);
    for (const [A, B] of edges) {
      // en la roseta las agujas empiezan lejos del centro (si no, todas convergen en un punto que se quema)
      const len = A.distanceTo(B) * (roseta ? 0.16 : 0.5), at = roseta ? A.clone().lerp(B, 0.3) : new THREE.Vector2().addVectors(A, B).multiplyScalar(0.5);
      const o = this.spawn('aguja', te, at, { size: len, color: col, life: 1.8 * this.cues.beatDur, spin: 0, glow: 0.08 });
      if (o) { o.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(B.x - A.x, B.y - A.y, 0).normalize()); o.start.set(o.target.x, o.target.y, o.target.z + 1.5); o.noSpin = true; }
    }
  }

  ambient(te) {
    const kinds = ['petalo', 'cuenta', 'perla', 'lentejuela', 'tubo', 'esquirla'], ch = this.chamber;
    const kind = kinds[Math.floor(Math.random() * kinds.length)], k = ch.mode === 'roseta' ? 1 : 0.6;
    this.spawn(kind, te, randomInChamber(ch), { size: (0.35 + Math.random() * 0.45) * k, color: this.palAt(Math.random()), life: (3 + Math.random() * 3) * this.cues.beatDur, flat: kind === 'lentejuela' });
  }

  // ---------- interacción ----------
  onPointerDown(x, y) { this.drag = { x, y, x0: x, y0: y, t: performance.now() }; }
  onPointerMove(x, y, buttons = 0) { const D = this.drag; if (!D || !buttons) return; this.tubeTarget -= (x - D.x) * 2.2; this.tubeA -= (x - D.x) * 2.2; D.x = x; D.y = y; }
  onPointerUp(x, y) {
    const D = this.drag; this.drag = null;
    if (!D || Math.hypot(x - D.x0, y - D.y0) > 0.02 || performance.now() - D.t > 350) return;
    // clic: piezas que caen en ese lugar (y en todos sus reflejos)
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const t = -ray.ray.origin.z / ray.ray.direction.z, w = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    const z = this.U.zoom.value, a = -this.tubeA, p = new THREE.Vector2((Math.cos(a) * w.x - Math.sin(a) * w.y) / z, (Math.sin(a) * w.x + Math.cos(a) * w.y) / z);
    const ch = this.chamber;
    let pc = null;
    for (const cp of ch.copies) { const q = unapply(cp, p); if (ch.mode === 'roseta' ? ch.half.every(([A, B, C]) => A * q.x + B * q.y + C >= 0) : inside(ch.poly, q)) { pc = q; break; } }
    if (!pc) return;
    const te = this.cues.t + 0.18, kinds = ['gema', 'estrella', 'petalo', 'cuenta', 'cristal'];
    kinds.forEach((kind, i) => this.spawn(kind, te + i * 0.04, pc.clone().add(new THREE.Vector2((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8)), { size: ch.mode === 'roseta' ? 0.9 : 0.55, color: this.palAt(Math.random()), life: 3 * this.cues.beatDur, travel: 0.18 }));
  }
  onWheel(d) { const cur = KALEIDO_MODES.indexOf(this.chamber.mode); this.params.set('caleidoscopio.espejos', KALEIDO_MODES[(cur + (d > 0 ? 1 : -1) + KALEIDO_MODES.length) % KALEIDO_MODES.length], 'ui'); }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), k = this.v2('fourier.intensidad'), thr = this.threshold, beat = Math.max(0.2, c.beatDur);
    const now = c.t;
    // salto en el tema (seek): se olvida lo programado
    if (Math.abs(now - this.lastT - dt) > 0.6) { this.spawned.clear(); for (const kk of KIND_NAMES) this.objs[kk].length = 0; }
    this.lastT = now;

    // pad Kaoss: X elige los espejos, Y el zoom
    const pad = this.app.kaoss;
    let zoomT = 1;
    if (pad?.active) {
      const i = Math.min(PAD_MODES.length - 1, Math.floor(pad.x * PAD_MODES.length));
      if (i !== this.padIdx) { this.padIdx = i; this.padMode = PAD_MODES[i]; this.requestChamber(); }
      zoomT = 0.75 + pad.y * 0.75;
    } else if (this.padMode) { this.padMode = null; this.padIdx = -1; this.requestChamber(); }

    // sección: espejos, paleta y estilo nuevos
    if (c.onSection) {
      this.modeIdx++; this.palIdx++; this.styleIdx++;
      if (v('espejos') === 'auto') this.requestChamber();
      if (v('estilo') === 'auto') this.applyStyle();
    }
    // cambio de espejos: implosión → espejos nuevos → expansión
    let swapScale = 1;
    if (this.switchT) {
      const S = this.switchT; S.t += dt;
      const T1 = Math.min(0.3, beat * 0.5), T2 = Math.min(0.6, beat);
      if (S.t < T1) swapScale = 1 - 0.8 * ease.smooth(S.t / T1);
      else { if (!S.swapped) { S.swapped = true; this.setChamber(this.currentMode()); } const x = Math.min(1, (S.t - T1) / T2); swapScale = 0.2 + 0.8 * ease.out3(x); if (x >= 1) this.switchT = null; }
    }

    // ---------- programación sincronizada: cada pieza llega en su golpe ----------
    const travel = Math.max(0.15, v('llegada') * beat);
    if (c.A) {   // tema analizado: se ve venir
      if (this.v2('fourier.notas')) for (const n of c.notesAhead(travel)) if (n.vel >= 0.3) this.schedule(`n${n.t0.toFixed(3)}:${n.midi}`, n.t0, (te) => this.noteObject(n.midi, n.vel, te, n.t1 - n.t0));
      for (let b = 0; b < 5; b++) for (const o of c.upcoming(b, travel)) if (o.s >= thr * BAND_THR[b]) this.schedule(`b${b}:${o.t.toFixed(3)}`, o.t, (te) => this.bandObject(b, o.s * k, te));
    } else {     // en vivo: en el acto
      if (this.v2('fourier.notas')) for (const n of c.notesOn) if (n.vel >= 0.3) this.noteObject(n.midi, n.vel, now + 0.05);
      for (let b = 0; b < 5; b++) if (c.bands[b].hit > thr * BAND_THR[b]) this.bandObject(b, c.bands[b].hit * k, now + 0.05);
    }
    for (const b of c.beatsAhead(travel)) {
      if (b.downbeat) this.schedule(`d${b.t.toFixed(3)}`, b.t, (te) => this.downbeatObjects(te));
      const alive = KIND_NAMES.reduce((a, kk) => a + this.objs[kk].length, 0);
      if (alive < v('densidad')) this.schedule(`a${b.t.toFixed(3)}`, b.t, (te) => { for (let i = 0; i < 1 + Math.floor((v('densidad') - alive) / 6); i++) this.ambient(te); });
    }
    // MIDI del DAW (en el acto)
    if (this.midiQ.length) {
      const drum = v('canalBateria');
      for (const e of this.midiQ.splice(0)) {
        if (e.ch === drum) { const n = e.note, b = n === 35 || n === 36 ? 0 : n === 38 || n === 40 ? 2 : [42, 44, 46].includes(n) ? 4 : n === 49 || n === 57 ? 3 : 1; this.bandObject(b, e.vel, now + 0.04); }
        else this.noteObject(e.note, e.vel, now + 0.04, 0.4);
      }
    }
    for (const [key, te] of this.spawned) if (te < now - 4) this.spawned.delete(key);

    // ---------- tubo: gira un paso en cada beat; el bombo late ----------
    if (c.onBeat) { this.tubeTarget += THREE.MathUtils.degToRad(v('giroBeat')) * (c.onDownbeat ? 1.5 : 1); this.seamFlash = c.onDownbeat ? 1 : 0.45; }
    this.tubeA += (this.tubeTarget - this.tubeA) * (1 - Math.exp(-dt * 6));
    this.pulse = Math.max(this.pulse * Math.exp(-dt * 6), c.bands[0].hit > thr ? c.bands[0].hit * k : 0);
    this.seamFlash *= Math.exp(-dt * 4);
    this.zoomS += (zoomT - this.zoomS) * (1 - Math.exp(-dt * 4));
    const ca = Math.cos(this.tubeA), sa = Math.sin(this.tubeA);
    this.U.tube.value.set(ca, -sa, sa, ca);
    this.U.zoom.value = this.zoomS * swapScale * (1 + this.pulse * 0.035);

    this.writeObjects(now, dt);

    // ---------- luz y color ----------
    const B = c.bands, U = this.U, PU = this.PU;
    U.time.value = t; U.gain.value = v('brillo');
    U.clipOn.value = v('recortar') ? 1 : 0;
    U.boxCol.value[0].setRGB(1, 0.97, 0.92).multiplyScalar(1.15 + this.pulse * 1.2);
    this.palColor(0, U.boxCol.value[1]).multiplyScalar(0.8 + B[1].env * 1.0);
    this.palColor(2, U.boxCol.value[2]).multiplyScalar(0.7 + B[2].env * 0.9);
    this.palColor(4, U.boxCol.value[3]).multiplyScalar(0.9 + B[4].env * 1.2);
    this.palColor(1, U.skyA.value).multiplyScalar(0.35); this.palColor(3, U.skyB.value).multiplyScalar(0.12);
    PU.pal.value.forEach((col, i) => this.palColor(i, col));
    PU.flowK.value = 0.3 + B[1].env * 0.8; PU.linesK.value = v('lineas'); PU.plateK.value = v('fondo') * (0.85 + B[1].env * 0.4);
    PU.seamK.value = v('costuras'); PU.seamFlash.value = this.seamFlash; PU.pulse.value = this.pulse;
    this.finish(dt);
  }

  /** Estado de cada pieza → textura de su tipo (posición, giro, escala, color, brillo). */
  writeObjects(now, dt) {
    const opaque = this.style === 'joyas' || this.style === 'mosaico', roseta = this.chamber.mode === 'roseta';
    for (const name of KIND_NAMES) {
      const list = this.objs[name], M = this.meshes[name], D = M.data;
      for (let i = list.length - 1; i >= 0; i--) if (now - list[i].te > list[i].life) list.splice(i, 1);
      let n = 0;
      for (const o of list) {
        const tau = now - o.te;
        let fade = 1, sc = o.size, flash = 0;
        if (tau < 0) {   // viajando hacia su golpe
          const p = THREE.MathUtils.clamp((now - o.ts) / Math.max(1e-3, o.te - o.ts), 0, 1);
          _p.set(THREE.MathUtils.lerp(o.start.x, o.target.x, ease.out3(p)), THREE.MathUtils.lerp(o.start.y, o.target.y, ease.out3(p)), THREE.MathUtils.lerp(o.start.z, o.target.z, ease.in2(p)));
          sc *= 0.35 + 0.65 * ease.out3(p); fade = ease.smooth(Math.min(1, p * 3));
        } else {         // aterrizó: destello, rebote y se asienta (en la roseta se hunde en el túnel)
          flash = Math.exp(-tau * 7);
          sc *= (1 + 0.22 * Math.exp(-tau * 7) * Math.cos(tau * 16)) * (1 + o.grow * tau);
          _p.copy(o.target); _p.z -= tau * (roseta ? 2.2 : 0.12);
          fade = 1 - ease.smooth(THREE.MathUtils.clamp((tau - o.life * 0.6) / (o.life * 0.4), 0, 1));
          if (o.grow) fade *= Math.exp(-tau * 1.5);
        }
        if (!o.noSpin) { const w = o.spin.length() * (tau < 0 ? 1.6 : 0.5); if (w > 1e-4) o.q.premultiply(_q.setFromAxisAngle(_s.copy(o.spin).normalize(), w * dt)); }
        if (opaque) sc *= Math.sqrt(fade);
        _m.compose(_p, o.q, _s.setScalar(Math.max(1e-4, sc)));
        const e = _m.elements, row = (r) => (r * MAXK + n) * 4;
        // filas: afín 3×4 (m0, m1, m2), color + fade, (brillo, destello, -, semilla)
        D[row(0)] = e[0]; D[row(0) + 1] = e[4]; D[row(0) + 2] = e[8]; D[row(0) + 3] = e[12];
        D[row(1)] = e[1]; D[row(1) + 1] = e[5]; D[row(1) + 2] = e[9]; D[row(1) + 3] = e[13];
        D[row(2)] = e[2]; D[row(2) + 1] = e[6]; D[row(2) + 2] = e[10]; D[row(2) + 3] = e[14];
        D[row(3)] = o.color.r; D[row(3) + 1] = o.color.g; D[row(3) + 2] = o.color.b; D[row(3) + 3] = fade;
        D[row(4)] = o.glow; D[row(4) + 1] = flash; D[row(4) + 2] = 0; D[row(4) + 3] = o.seed;
        n++;
      }
      M.tex.needsUpdate = true;
      M.mesh.geometry.instanceCount = n * this.U.nCopies.value;
      M.mesh.visible = n > 0;
    }
  }
}
