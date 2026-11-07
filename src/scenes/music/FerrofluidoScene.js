import * as THREE from 'three';
import { MusicScene } from './MusicScene.js';
import { WetFloor } from '../../stage/WetFloor.js';

/**
 * FERROFLUIDO: una gota de ferrofluido (líquido negro, brillante como aceite)
 * flotando sobre un piso espejo, en un estudio con cajas de luz de colores.
 * El "campo magnético" es la música: con el bajo salen las púas (la
 * inestabilidad de Rosensweig: un panal de conos), el bombo la aplasta y la
 * hace saltar, la caja tuerce el panal, los platillos hacen temblar las
 * puntas y las notas encienden púas del color de la nota (círculo de quintas,
 * la altura de la nota sube por la gota). Cada sección cambia de forma:
 * erizo flotante → charco con corona de púas → gota lisa que respira.
 *
 * Púas: N puntos de Fibonacci esférica; cada vértice busca el más cercano con
 * la inversa de Keinert et al. (2015) y se levanta un cono suave. Las
 * normales salen por diferencias finitas de la misma función, en el shader.
 * Reflejos: las cajas de luz se capturan con una CubeCamera cada cuadro.
 */
const PITCH_HUE = (midi) => ((midi % 12) * 7 % 12) / 12;
const FORMS = ['erizo', 'charco', 'gota'];
const MAXN = 6;

const spikeChunk = /* glsl */ `
  uniform float sfN, spikeH, spikeR, sharp, tremble, time, formT, smoothT;
  uniform mat3 twist;
  uniform vec3 squash;
  uniform vec3 noteDir[${MAXN}];
  uniform vec3 noteCol[${MAXN}];
  varying vec3 vGlow;
  const float PHI_ = 1.61803398875;
  vec2 inverseSF(vec3 p, float n) {
    float m = 1.0 - 1.0 / n;
    float phi = min(atan(p.y, p.x), 3.14159265), cosTheta = p.z;
    float k = max(2.0, floor(log(n * 3.14159265 * sqrt(5.0) * (1.0 - cosTheta * cosTheta)) / log(PHI_ * PHI_)));
    float Fk = pow(PHI_, k) / sqrt(5.0);
    vec2 F = vec2(floor(Fk + 0.5), floor(Fk * PHI_ + 0.5));
    vec2 ka = 2.0 * F / n;
    vec2 kb = 2.0 * 3.14159265 * (fract((F + 1.0) * PHI_) - (PHI_ - 1.0));
    mat2 iB = mat2(ka.y, -ka.x, kb.y, -kb.x) / (ka.y * kb.x - ka.x * kb.y);
    vec2 c = floor(iB * vec2(phi, cosTheta - m));
    float d = 8.0, j = 0.0;
    for (int s = 0; s < 4; s++) {
      vec2 uv = vec2(float(s - 2 * (s / 2)), float(s / 2));
      float i = floor(dot(F, uv + c) + 0.5);
      float ph = 2.0 * 3.14159265 * fract(i * PHI_);
      float ct = m - 2.0 * i / n, st = sqrt(max(0.0, 1.0 - ct * ct));
      vec3 q = vec3(cos(ph) * st, sin(ph) * st, ct);
      float dd = dot(q - p, q - p);
      if (dd < d) { d = dd; j = i; }
    }
    return vec2(j, sqrt(d));
  }
  // superficie: dirección unitaria → punto (forma base + púa)
  vec3 ferro(vec3 p, out float tip) {
    vec2 sf = inverseSF(twist * p, sfN);
    float x = max(0.0, 1.0 - sf.y / spikeR);
    float h = spikeH * pow(x, sharp) * (1.0 + tremble * 0.25 * sin(time * 47.0 + sf.x * 2.3));
    tip = pow(x, 6.0);
    // charco: elipsoide aplastado, púas sólo arriba; gota: sin púas
    vec3 sc = mix(vec3(1.0), vec3(1.45, 0.42, 1.45), formT);
    vec3 n = normalize(p / sc);
    float w = mix(1.0, smoothstep(-0.05, 0.55, p.y), formT) * (1.0 - smoothT);
    return (p * sc + n * h * w) * squash;
  }
`;

export class FerrofluidoScene extends MusicScene {
  static id = 'ferrofluido';
  static title = 'Ferrofluido';
  constructor(app) {
    super(app, 'ferrofluido', 'Ferrofluido');
    this.H = 0; this.squash = new THREE.Vector3(1, 1, 1); this.squashV = new THREE.Vector3(); this.jump = 0; this.jumpV = 0;
    this.twistA = 0; this.twistV = 0; this.formIndex = 0; this.formT = 0; this.smoothT = 0; this.trem = 0;
    this.look = { 'look.bloom': 0.6, 'look.bloomThreshold': 0.85, 'look.bloomRadius': 0.45, 'look.exposure': 1, 'fx.vineta': 0.5, 'fx.grano': 0.05, 'fx.contraste': 1.12, 'fx.saturacion': 1.05, 'fx.tinte': 0 };
    this.padLabels = { title: 'Ferrofluido · imán', x: 'giro del panal', y: 'fuerza del imán (púas)', programs: false };
  }

  defineParams() {
    super.defineParams();
    this.p('forma', { type: 'option', options: ['auto', ...FORMS], default: 'auto', label: 'forma (auto = cambia con la sección)' });
    this.p('puas', { min: 60, max: 900, default: 320, step: 1, label: 'cantidad de púas' });
    this.p('iman', { min: 0, max: 2, default: 1, step: 0.01, label: 'fuerza del imán (bajo → púas)' });
    this.p('agudeza', { min: 0.6, max: 4, default: 1.7, step: 0.01, label: 'agudeza de las púas' });
    this.p('salto', { min: 0, max: 2, default: 1, step: 0.01, label: 'salto con el bombo' });
    this.p('giro', { min: 0, max: 2, default: 1, step: 0.01, label: 'torsión con la caja' });
    this.p('temblor', { min: 0, max: 2, default: 1, step: 0.01, label: 'temblor con los platillos' });
    this.p('notas', { min: 0, max: 3, default: 1, step: 0.01, label: 'púas encendidas por las notas' });
    this.p('luces', { min: 0, max: 3, default: 1, step: 0.01, label: 'cajas de luz' });
    this.p('detalle', { type: 'option', options: ['bajo', 'medio', 'alto'], default: 'medio', label: 'detalle de la malla' });
  }

  build() {
    const s = this.scene, r = this.app.renderer;
    s.background = new THREE.Color(0x010102);

    // cajas de luz: se ven en la escena y se reflejan (CubeCamera sobre una escena aparte)
    this.envScene = new THREE.Scene(); this.envScene.background = new THREE.Color(0x000000);
    this.boxes = [];
    const box = (w, h, pos, look, hue, envOnly = false) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      for (const sc of envOnly ? [this.envScene] : [s, this.envScene]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.copy(pos); m.lookAt(look); sc.add(m); }
      this.boxes.push({ mat, hue, I: 0 });
    };
    const O = new THREE.Vector3(0, 0.8, 0);
    box(7, 2.2, new THREE.Vector3(0, 6.5, 1), O, -1);                                // cenital (blanca)
    box(0.5, 5, new THREE.Vector3(-4.6, 2, 0.5), O, 0);                              // tiras laterales
    box(0.5, 5, new THREE.Vector3(4.6, 2, 0.5), O, 1);
    for (let i = 0; i < 5; i++) box(0.35, 4.2, new THREE.Vector3(-4 + i * 2, 2.4, -5), new THREE.Vector3(-4 + i * 2, 2.4, 10), 2 + i);   // fondo
    box(9, 0.3, new THREE.Vector3(0, 0.5, 7), O, 7, true);                           // tira baja frontal (sólo en el reflejo)
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(0.1, 50, this.cubeRT); this.cubeCam.position.copy(O);

    // la gota
    this.U = {
      sfN: { value: 320 }, spikeH: { value: 0 }, spikeR: { value: 0.1 }, sharp: { value: 1.7 }, tremble: { value: 0 }, time: { value: 0 },
      formT: { value: 0 }, smoothT: { value: 0 }, twist: { value: new THREE.Matrix3() }, squash: { value: new THREE.Vector3(1, 1, 1) },
      noteDir: { value: Array.from({ length: MAXN }, () => new THREE.Vector3(0, 1, 0)) }, noteCol: { value: Array.from({ length: MAXN }, () => new THREE.Vector3()) },
    };
    this.mat = new THREE.MeshPhysicalMaterial({ color: 0x050505, metalness: 0.55, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMap: this.cubeRT.texture, envMapIntensity: 1.6 });
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${spikeChunk}`)
        .replace('#include <beginnormal_vertex>', `
          vec3 pd = normalize(position);
          vec3 t1 = normalize(abs(pd.y) < 0.99 ? cross(pd, vec3(0.0, 1.0, 0.0)) : cross(pd, vec3(1.0, 0.0, 0.0)));
          vec3 t2 = cross(pd, t1);
          float tip, tip1, tip2; const float E = 0.0035;
          vec3 S0 = ferro(pd, tip), S1 = ferro(normalize(pd + t1 * E), tip1), S2 = ferro(normalize(pd + t2 * E), tip2);
          vec3 objectNormal = normalize(cross(S1 - S0, S2 - S0));
          if (dot(objectNormal, pd) < 0.0) objectNormal = -objectNormal;
          // brillo de las notas en las puntas
          vGlow = vec3(0.0);
          for (int i = 0; i < ${MAXN}; i++) { float a = max(0.0, dot(pd, noteDir[i])); vGlow += noteCol[i] * pow(a, 500.0) * tip; }
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', 'vec3 transformed = S0;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vGlow;');
    };
    this.mat.customProgramCacheKey = () => 'ferrofluido';
    this.blob = new THREE.Mesh(this.makeGeo(), this.mat); this.blob.frustumCulled = false;
    this.blob.position.copy(O); s.add(this.blob);

    // piso espejo
    this.floor = new WetFloor({ size: 40, repeat: 8, puddles: 1.6, reflect: 0.95, color: 0x0b0b0d, textureWidth: 1024, textureHeight: 1024 });
    this.floor.position.y = -0.55; s.add(this.floor);
    s.add(new THREE.HemisphereLight(0x303848, 0x000000, 0.15));
    this.rim = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.6, 2); this.rim.position.set(0, 5, -4); this.rim.target.position.copy(O); s.add(this.rim, this.rim.target);

    this.params.onChange((id) => { if (id === 'ferrofluido.detalle') { this.blob.geometry.dispose(); this.blob.geometry = this.makeGeo(); } });
    this.fixed = { pos: new THREE.Vector3(0, 1.25, 6.4), look: new THREE.Vector3(0, 0.55, 0), fov: 38 };
    this.subject.radius = 2; this.subject.distance = 7.2;
  }

  makeGeo() { return new THREE.IcosahedronGeometry(1, { bajo: 48, medio: 80, alto: 120 }[this.v('detalle')]); }

  // ---------- interacción: arrastrar gira el panal ----------
  onPointerDown(x, y) { this.drag = { x, y }; }
  onPointerUp() { this.drag = null; }
  onPointerMove(x, y, buttons) { if (!this.drag || !buttons) return; this.twistV += (x - this.drag.x) * 40; this.drag.x = x; this.drag.y = y; }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), k = this.v2('fourier.intensidad'), thr = this.threshold, B = c.bands, U = this.U;
    const pad = this.app.kaoss;
    // forma
    if (c.onSection && v('forma') === 'auto') this.formIndex = (this.formIndex + 1) % FORMS.length;
    const form = v('forma') === 'auto' ? FORMS[this.formIndex] : v('forma');
    this.formT += ((form === 'charco' ? 1 : 0) - this.formT) * (1 - Math.exp(-dt * 2.5));
    this.smoothT += ((form === 'gota' ? 0.85 : 0) - this.smoothT) * (1 - Math.exp(-dt * 2));

    // imán: el bajo levanta las púas (con el pad, Y es el imán)
    let field = (0.12 + 0.75 * Math.max(0, B[1].env - 0.1) + 0.35 * B[0].env) * v('iman') * k;
    if (pad?.active) field = pad.y * 1.2 * v('iman');
    this.H += (field * 0.42 - this.H) * (1 - Math.exp(-dt * (field * 0.42 > this.H ? 14 : 5)));
    // bombo: salto y aplastamiento (resortes)
    if (B[0].hit > thr) { this.jumpV += 2.2 * B[0].hit * v('salto') * k; this.squashV.y -= 3 * B[0].hit * v('salto') * k; this.H += 0.08 * B[0].hit; }
    this.jumpV += (-this.jump * 60 - this.jumpV * 7) * dt; this.jump += this.jumpV * dt;
    this.squashV.y += ((1 - this.squash.y) * 160 - this.squashV.y * 9) * dt; this.squash.y += this.squashV.y * dt;
    this.squash.x = this.squash.z = 1 + (1 - this.squash.y) * 0.5;
    // caja: torsión del panal
    if (B[2].hit > thr) this.twistV += (Math.random() < 0.5 ? -1 : 1) * 2.5 * B[2].hit * v('giro') * k;
    if (pad?.active) this.twistV += (pad.x - 0.5) * 6 * dt * 10;
    this.twistV *= Math.exp(-dt * 2.5); this.twistA += this.twistV * dt + dt * 0.05;
    U.twist.value.setFromMatrix4(new THREE.Matrix4().makeRotationY(this.twistA));
    // platillos: temblor
    this.trem = Math.max(this.trem * Math.exp(-dt * 8), B[4].hit > thr ? B[4].hit * v('temblor') : 0);
    // notas: púas encendidas (altura = nota, ángulo = clase de nota)
    const notes = (c.notesActive || []).filter((n) => n.vel > 0.25).slice(0, MAXN);
    for (let i = 0; i < MAXN; i++) {
      const n = notes[i], col = U.noteCol.value[i];
      if (!n) { col.multiplyScalar(Math.exp(-dt * 6)); continue; }
      const yy = THREE.MathUtils.clamp((n.midi - 36) / 60, 0, 1) * 1.6 - 0.8, a = (n.midi % 12) / 12 * Math.PI * 2 + this.twistA;
      U.noteDir.value[i].set(Math.cos(a) * Math.sqrt(1 - yy * yy * 0.6), yy, Math.sin(a) * Math.sqrt(1 - yy * yy * 0.6)).normalize();
      const cc = new THREE.Color().setHSL(this.hue(PITCH_HUE(n.midi)), 1, 0.55).multiplyScalar(12 * n.vel * v('notas'));
      col.set(cc.r, cc.g, cc.b);
    }

    const N = v('puas');
    U.sfN.value = N; U.spikeR.value = 1.05 * Math.sqrt(4 / N); U.spikeH.value = this.H; U.sharp.value = v('agudeza');
    U.tremble.value = this.trem; U.time.value = t; U.formT.value = this.formT; U.smoothT.value = this.smoothT;
    U.squash.value.copy(this.squash);
    this.blob.position.y = 0.8 + this.jump * 0.35 - this.formT * 0.85 + Math.sin(t * 0.8) * 0.04 * (1 - this.formT);
    this.blob.rotation.y = t * 0.08;

    // cajas de luz con la música
    const L = v('luces'), sec = c.section?.type ?? 0;
    this.boxes.forEach((b, i) => {
      let I = 0, col = new THREE.Color();
      if (b.hue === -1) { I = 1.2 + B[0].pulse * 3 + this.flash * 1.5; col.setRGB(1, 0.97, 0.92); }
      else if (b.hue <= 1) { I = 0.6 + B[1].env * 2.5; col.copy(this.bandColor(b.hue === 0 ? 1 : 2, 0.55)); }
      else if (b.hue < 7) { const j = b.hue - 2, on = (c.beat % 5) === j ? 1 : 0; I = 0.5 + on * 1.6 * (1 - c.beatPhase) + B[3].pulse * 0.8; col.copy(this.sectionColor(sec + j * 0.0, 0.55)).offsetHSL(j * 0.04, 0, 0); }
      else { I = 0.8 + B[4].env * 2; col.copy(this.sectionColor(sec + 3, 0.6)); }
      b.mat.color.copy(col).multiplyScalar(I * L);
    });
    this.rim.color.copy(this.sectionColor(sec, 0.6)); this.rim.intensity = 40 + 120 * B[1].env;

    // reflejos: capturar las cajas de luz desde la gota
    this.cubeCam.position.copy(this.blob.position);
    this.cubeCam.update(this.app.renderer, this.envScene);
    this.finish(dt);
  }
}
