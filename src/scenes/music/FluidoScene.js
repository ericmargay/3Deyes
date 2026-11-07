import * as THREE from 'three';
import { MusicScene } from './MusicScene.js';
import { Fluid } from '../../sim/Fluid.js';
import { WetFloor } from '../../stage/WetFloor.js';

/**
 * FLUIDO SONORO: un fluido de verdad (Navier–Stokes en GPU) que la música
 * empuja y tiñe. Cada elemento tiene su gesto, siempre el mismo, para que se
 * lea a simple vista:
 *
 *   bombo     chorro hacia arriba desde el centro del piso + onda expansiva
 *   bajo      humo cálido que sube desde las esquinas mientras suena
 *   caja      dos chorros que chocan en el medio, desde los costados
 *   agudos    chorros diagonales desde arriba
 *   platillos gotas finas que caen desde arriba
 *   notas     tinta del color de la nota (círculo cromático) a la altura de
 *             la nota: grave a la izquierda, agudo a la derecha
 *   beat      remolino que alterna de sentido · compás: respiración
 *   sección   la paleta gira y el agua se limpia
 *
 * Profundidad: cada banda tiñe a su propia profundidad (graves al fondo,
 * platillos adelante); el canal A del tinte la transporta con el fluido, y
 * al dibujar cada píxel se busca dónde cruza el rayo de cada ojo esa
 * profundidad: el estéreo es exacto y el humo tiene espesor.
 *
 * Interacción: arrastrar revuelve y tiñe; el pad Kaoss (Z) es un pincel de
 * fluido (X, Y = dónde; velocidad = el movimiento del dedo).
 * Simetría: ninguna, espejo (Rorschach) o caleidoscopio de 3–12 pliegues.
 */
const volVert = /* glsl */ `varying vec3 vWorld; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const volFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D dye;
  uniform vec3 boxMin, boxMax;
  uniform vec2 texel;
  uniform float gain, density, thick, shade, circle, aspect;
  varying vec3 vWorld;
  vec2 uvAt(vec3 p) { return (p.xy - boxMin.xy) / (boxMax.xy - boxMin.xy); }
  void main() {
    vec3 ro = cameraPosition, rd = normalize(vWorld - ro);
    // cruce del rayo con el plano de profundidad z (en unidades de mundo)
    float halfD = 0.5 * (boxMax.z - boxMin.z), zMid = 0.5 * (boxMax.z + boxMin.z);
    float z = zMid; vec2 uv; vec4 d;
    for (int i = 0; i < 4; i++) {
      float t = (z - ro.z) / rd.z;
      uv = uvAt(ro + rd * t);
      d = texture2D(dye, uv);
      float rho = (d.r + d.g + d.b) / 3.0;
      float zc = rho > 1e-4 ? clamp(d.a / rho, -1.0, 1.0) : 0.0;
      z = zMid + zc * halfD;
    }
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
    float rho = (d.r + d.g + d.b) / 3.0;
    if (rho < 0.002) discard;
    vec3 col = d.rgb / rho;
    // espesor: más denso = más grueso; el rayo oblicuo atraviesa más
    float w = thick * (0.25 + 0.75 * sqrt(clamp(rho, 0.0, 4.0) / 4.0));
    float opacity = 1.0 - exp(-rho * density * w / max(0.25, abs(rd.z)));
    // relieve: normal a partir del gradiente de densidad (luz rasante de arriba a la izquierda)
    float rl = dot(texture2D(dye, uv - vec2(texel.x, 0.0)).rgb, vec3(1.0 / 3.0)), rr = dot(texture2D(dye, uv + vec2(texel.x, 0.0)).rgb, vec3(1.0 / 3.0));
    float rb = dot(texture2D(dye, uv - vec2(0.0, texel.y)).rgb, vec3(1.0 / 3.0)), rt = dot(texture2D(dye, uv + vec2(0.0, texel.y)).rgb, vec3(1.0 / 3.0));
    vec3 n = normalize(vec3(rl - rr, rb - rt, 0.08));
    vec3 L = normalize(vec3(-0.5, 0.7, 0.6));
    float lit = mix(1.0, 0.55 + 0.6 * max(dot(n, L), 0.0) + 0.5 * pow(max(dot(reflect(-L, n), -rd), 0.0), 24.0), shade);
    // máscara circular (caleidoscopio)
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    float m = circle > 0.5 ? 1.0 - smoothstep(0.44, 0.5, length(q)) : 1.0;
    vec3 c = col * opacity * gain * lit * m;
    gl_FragColor = vec4(c / (1.0 + 0.35 * max(max(c.r, c.g), c.b)), 1.0);
  }
`;

const _v = new THREE.Vector3(), _p = new THREE.Vector3();
const PITCH_HUE = (midi) => ((midi % 12) * 7 % 12) / 12;   // círculo de quintas: notas vecinas armónicamente = colores vecinos

export class FluidoScene extends MusicScene {
  static id = 'fluidosonoro';
  static title = 'Fluido sonoro';
  constructor(app) {
    super(app, 'fluidosonoro', 'Fluido sonoro');
    this.W = 16; this.H = 9; this.pointer = { x: 0, y: 0, down: false, px: 0, py: 0 };
    this.swirlSign = 1; this.wash = 0; this.lastPad = null;
    this.look = { 'look.bloom': 0.9, 'look.bloomThreshold': 0.7, 'look.bloomRadius': 0.6, 'fx.tinte': 0, 'fx.contraste': 1.05, 'fx.vineta': 0.45, 'fx.grano': 0.05, 'fx.estela': 0 };
    this.padLabels = { title: 'Fluido · pincel', x: 'dónde (horizontal)', y: 'dónde (vertical)', programs: false };
  }

  defineParams() {
    super.defineParams();
    this.p('simetria', { type: 'option', options: ['ninguna', 'espejo', '3', '4', '5', '6', '8', '12'], default: 'ninguna', label: 'simetría (espejo = Rorschach, n = caleidoscopio)' });
    this.p('color', { type: 'option', options: ['bandas', 'sección', 'notas'], default: 'sección', label: 'color' });
    this.p('vorticidad', { min: 0, max: 60, default: 22, step: 0.5, label: 'vorticidad (remolinos)' });
    this.p('disipacion', { min: 0, max: 3, default: 0.75, step: 0.01, label: 'disipación del tinte' });
    this.p('viscosidad', { min: 0, max: 3, default: 0.3, step: 0.01, label: 'freno del movimiento' });
    this.p('fuerza', { min: 0, max: 3, default: 1, step: 0.01, label: 'fuerza de los golpes' });
    this.p('tinta', { min: 0, max: 3, default: 1, step: 0.01, label: 'cantidad de tinta' });
    this.p('profundidad', { min: 0, max: 8, default: 3.2, step: 0.01, label: 'profundidad del volumen' });
    this.p('espesor', { min: 0.05, max: 3, default: 1.1, step: 0.01, label: 'espesor del humo' });
    this.p('densidad', { min: 0.1, max: 8, default: 2.2, step: 0.01, label: 'densidad (opacidad)' });
    this.p('brillo', { min: 0, max: 4, default: 1.1, step: 0.01, label: 'brillo' });
    this.p('relieve', { min: 0, max: 1, default: 0.65, step: 0.01, label: 'relieve (luz rasante)' });
    this.p('resolucion', { type: 'option', options: ['baja', 'media', 'alta'], default: 'media', label: 'resolución' });
    this.p('limpiar', { type: 'trigger', label: 'limpiar' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x020205);
    s.fog = new THREE.FogExp2(0x020205, 0.012);
    const res = { baja: [112, 512], media: [160, 768], alta: [224, 1024] }[this.v('resolucion')];
    this.fluid = new Fluid(this.app.renderer, { aspect: this.W / this.H, simRes: res[0], dyeRes: res[1] });
    const D = this.v('profundidad');
    this.box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
      uniforms: { dye: { value: null }, boxMin: { value: new THREE.Vector3() }, boxMax: { value: new THREE.Vector3() }, texel: { value: new THREE.Vector2() }, gain: { value: 1 }, density: { value: 2 }, thick: { value: 1 }, shade: { value: 0.6 }, circle: { value: 0 }, aspect: { value: this.W / this.H } },
      vertexShader: volVert, fragmentShader: volFrag, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.box.name = 'fluido'; this.box.frustumCulled = false; this.box.renderOrder = 5;
    s.add(this.box);
    // aristas de la pecera (muy tenues)
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x334055, transparent: true, opacity: 0.35 }));
    this.edges.name = 'pecera'; this.edges.userData.helper = true; s.add(this.edges);
    this.setBox(D);
    this.floor = new WetFloor({ size: 80, repeat: 12, puddles: 0.6, reflect: 0.9, color: 0x4a4e58 });
    this.floor.position.y = -this.H / 2 - 0.6; this.floor.userData.helper = true; s.add(this.floor);
    s.add(new THREE.HemisphereLight(0x223344, 0x050508, 0.35));
    this.params.onChange((id, v) => {
      if (id === 'fluidosonoro.limpiar') this.fluid.clearAll();
      if (id === 'fluidosonoro.profundidad') this.setBox(v);
      if (id === 'fluidosonoro.resolucion') { const r = { baja: [112, 512], media: [160, 768], alta: [224, 1024] }[v]; this.fluid.resize({ simRes: r[0], dyeRes: r[1] }); }
    });
    this.fixed = { pos: new THREE.Vector3(0, 0.6, 15.5), look: new THREE.Vector3(0, -0.2, 0), fov: 40 };
    this.subject.radius = 6; this.subject.distance = 15;
  }

  setBox(D) {
    const W = this.W, H = this.H;
    this.box.scale.set(W, H, Math.max(0.05, D)); this.edges.scale.copy(this.box.scale);
    const u = this.box.material.uniforms;
    u.boxMin.value.set(-W / 2, -H / 2, -D / 2); u.boxMax.value.set(W / 2, H / 2, D / 2);
  }

  /** Color de un golpe según el modo. band: 0..4, o una nota (midi). */
  colorFor(band, midi = null, l = 0.55) {
    const mode = this.v('color'), sec = this.cues.section?.type ?? 0;
    if (mode === 'notas' && midi != null) return new THREE.Color().setHSL(this.hue(PITCH_HUE(midi)), 0.95, l);
    if (mode === 'bandas') return this.bandColor(band, l);
    // sección: paleta análoga alrededor del color de la sección
    const base = this.sectionColor(sec).getHSL({ h: 0, s: 0, l: 0 }).h;
    const off = [-0.08, -0.03, 0.04, 0.5, 0.1][band];
    return new THREE.Color().setHSL((base + off + 1) % 1, 0.9, l);
  }

  /** Tinta + fuerza. x, y en 0..1; v en celdas / s; z = profundidad -1 (fondo) … 1 (frente). */
  emit(x, y, r, color, amount, z, vx = 0, vy = 0, ring = false) {
    const F = this.fluid, k = amount * this.v('tinta'), f = this.v('fuerza');
    if (F.symmetry.mode === 2) {   // caleidoscopio: el rectángulo se mete dentro del círculo
      const sx = (this.H / this.W) * 0.92;
      x = 0.5 + (x - 0.5) * sx; y = 0.5 + (y - 0.5) * 0.92; r *= 0.8; vx *= 0.8; vy *= 0.8;
    }
    const rho = ((color.r + color.g + color.b) / 3) * k;
    F.dye(x, y, r, color.r * k, color.g * k, color.b * k, z * rho);
    if (vx || vy) F.force(x, y, r * 1.2, vx * f, vy * f, false);
    if (ring) F.burst(x, y, r * 1.5, Math.hypot(vx, vy) * f * 0.6, true);
  }

  // ---------- interacción ----------
  toUv(x, y) {
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const t = -ray.ray.origin.z / ray.ray.direction.z;
    _p.copy(ray.ray.origin).addScaledVector(ray.ray.direction, t);
    return [(_p.x + this.W / 2) / this.W, (_p.y + this.H / 2) / this.H];
  }
  onPointerDown(x, y) { const [u, v] = this.toUv(x, y); Object.assign(this.pointer, { down: true, x: u, y: v, px: u, py: v }); }
  onPointerUp() { this.pointer.down = false; }
  onPointerMove(x, y, buttons = 0) {
    const [u, v] = this.toUv(x, y), P = this.pointer;
    if (buttons === 0) P.down = false;
    if (P.down) { P.px = P.x; P.py = P.y; P.x = u; P.y = v; P.moved = true; }
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), F = this.fluid, k = this.v2('fourier.intensidad');
    // simetría
    const sym = v('simetria');
    F.symmetry.mode = sym === 'ninguna' ? 0 : sym === 'espejo' ? 1 : 2;
    F.symmetry.folds = sym === 'ninguna' || sym === 'espejo' ? 2 : Number(sym);
    F.symmetry.radius = 0.48;
    // parámetros del solver
    F.o.curl = v('vorticidad'); F.o.dyeDissipation = v('disipacion') + this.wash * 3; F.o.velDissipation = v('viscosidad');
    this.wash = Math.max(0, this.wash - dt * 1.2);
    const thr = this.threshold;

    // ---------- gestos de la música ----------
    const B = c.bands, CS = 260;   // escala de velocidades (celdas / s)
    if (B[0].hit > thr) {           // bombo: chorro hacia arriba + onda expansiva
      const s = B[0].hit * k;
      this.emit(0.5 + (Math.random() - 0.5) * 0.04, 0.06, 0.04 + 0.04 * s, this.colorFor(0), 0.5 * s, -0.7, 0, CS * 2.4 * s, true);
    }
    if (B[1].env > 0.25) {          // bajo continuo: humo desde las esquinas
      const e = (B[1].env - 0.25) * 1.3;
      const col = this.colorFor(1);
      this.emit(0.1, 0.05, 0.05, col, e * 0.12, -0.35, CS * 0.18 * e, CS * 0.5 * e);
      this.emit(0.9, 0.05, 0.05, col, e * 0.12, -0.35, -CS * 0.18 * e, CS * 0.5 * e);
    }
    if (B[2].hit > thr) {           // caja: chorros que chocan en el medio
      const s = B[2].hit * k, y = 0.45 + (Math.random() - 0.5) * 0.15, col = this.colorFor(2);
      this.emit(0.02, y, 0.045, col, 0.7 * s, 0.0, CS * 2.6 * s, 0);
      this.emit(0.98, y, 0.045, col, 0.7 * s, 0.0, -CS * 2.6 * s, 0);
    }
    if (B[3].hit > thr * 1.3) {     // agudos: diagonales desde arriba
      const s = B[3].hit * k, side = Math.random() < 0.5 ? 0 : 1;
      this.emit(side ? 0.95 : 0.05, 0.95, 0.03, this.colorFor(3), 0.45 * s, 0.4, (side ? -1 : 1) * CS * 1.4 * s, -CS * 1.2 * s);
    }
    if (B[4].hit > thr * 1.2) {     // platillos: gotas finas que caen
      const s = B[4].hit * k, n = 2 + Math.round(s * 4);
      for (let i = 0; i < n; i++) this.emit(0.15 + Math.random() * 0.7, 0.86 + Math.random() * 0.1, 0.012 + Math.random() * 0.01, this.colorFor(4, null, 0.7), 0.35 * s, 0.8, (Math.random() - 0.5) * CS * 0.3, -CS * (0.4 + Math.random() * 0.6) * s);
    }
    if (this.v2('fourier.notas')) for (const n of c.notesOn) {   // notas: tinta del color de la nota, a su altura
      if (n.vel < 0.45) continue;
      const x = 0.08 + 0.84 * THREE.MathUtils.clamp((n.midi - 36) / 60, 0, 1);
      const col = new THREE.Color().setHSL(this.hue(PITCH_HUE(n.midi)), 0.9, 0.6);
      this.emit(x, 0.62 + (Math.random() - 0.5) * 0.08, 0.018 + 0.02 * n.vel, col, 0.35 * n.vel * k, 0.25, 0, CS * 0.25);
    }
    if (c.onBeat) {                 // beat: remolino alternado en el centro
      this.swirlSign = c.onDownbeat ? -this.swirlSign : this.swirlSign;
      const s = 0.6 * k * this.v('fuerza'), a = this.swirlSign;
      for (let i = 0; i < 4; i++) { const th = (i / 4) * Math.PI * 2; F.force(0.5 + Math.cos(th) * 0.12 / (this.W / this.H), 0.5 + Math.sin(th) * 0.12, 0.06, -Math.sin(th) * CS * s * a, Math.cos(th) * CS * s * a); }
    }
    if (c.onSection) { this.wash = 1; F.force(0.35, 0.5, 0.12, 0, CS * 2); F.force(0.65, 0.5, 0.12, 0, -CS * 2); }

    // ---------- interacción ----------
    const P = this.pointer;
    if (P.down && P.moved) {
      const dx = (P.x - P.px) / dt, dy = (P.y - P.py) / dt;
      this.emit(P.x, P.y, 0.03, this.colorFor(Math.floor(t * 0.7) % 5, null, 0.6), 0.25, 0.3, dx * CS * 0.6, dy * CS * 0.6);
      P.moved = false;
    }
    const pad = this.app.kaoss;
    if (pad?.active) {
      const x = pad.x, y = pad.y, L = this.lastPad || { x, y };
      const vx = (x - L.x) / Math.max(dt, 1e-3), vy = (y - L.y) / Math.max(dt, 1e-3);
      this.emit(x, y, 0.035, this.colorFor(Math.floor(t * 0.5) % 5, null, 0.6), 0.3, 0.5, vx * CS * 0.5, vy * CS * 0.5);
      this.lastPad = { x, y };
    } else this.lastPad = null;

    F.step(dt);

    // ---------- dibujo ----------
    const u = this.box.material.uniforms;
    u.dye.value = F.dyeTexture; u.texel.value.copy(F.dyeTexel).multiplyScalar(1.5);
    u.gain.value = v('brillo') * (1 + this.flash * 0.15); u.density.value = v('densidad'); u.thick.value = v('espesor');
    u.shade.value = v('relieve'); u.circle.value = F.symmetry.mode === 2 ? 1 : 0;
    this.edges.material.opacity = 0.18 + this.kick * 0.25;
    this.finish(dt);
  }
}
