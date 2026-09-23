import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

/**
 * TRACK: viaje por un túnel neón. La cámara recorre un circuito cerrado; los
 * objetos aparecen al ritmo (reloj de BPM interno, beat del audio o trigger
 * externo) y pasan de largo. Todo tiene cuerpo oscuro y bordes de luz, y el
 * bloom de la salida estéreo les da el halo. El mouse mira alrededor; el
 * objeto que queda en el centro de la vista se "activa" con clic (o con el
 * trigger track.hit): destella, gira y se aparta.
 *
 * Unidades: metros. 1 vuelta al circuito ≈ 1 km.
 */
const TABLE_N = 4096;

/**
 * Actos: cada portal abre una nueva "performance". Un acto es un preset de
 * parámetros que se interpola suavemente (los numéricos) o se aplica al pasar
 * el portal (sección, familia). Se pueden editar en vivo y guardar como preset.
 */
export const ACTS = {
  lineas:   { shape: 'square',  radius: 5,  ringSpacing: 4,  hue: 0.62, hueObjects: 0.55, lineIntensity: 2.2, fog: 0.012, speed: 18, objectFamily: 'poliedros', objectSize: 1,   spawnPerBeat: 1, particles: 1500 },
  aros:     { shape: 'circle',  radius: 7,  ringSpacing: 6,  hue: 0.80, hueObjects: 0.90, lineIntensity: 2.6, fog: 0.010, speed: 26, objectFamily: 'aros',      objectSize: 1,   spawnPerBeat: 1, particles: 800 },
  cristales:{ shape: 'octagon', radius: 6,  ringSpacing: 10, hue: 0.50, hueObjects: 0.45, lineIntensity: 3,   fog: 0.016, speed: 22, objectFamily: 'cristales', objectSize: 1.6, spawnPerBeat: 2, particles: 3000 },
  paneles:  { shape: 'square',  radius: 8,  ringSpacing: 3,  hue: 0.08, hueObjects: 0.12, lineIntensity: 2,   fog: 0.014, speed: 30, objectFamily: 'paneles',   objectSize: 2,   spawnPerBeat: 2, particles: 500 },
  vacio:    { shape: 'circle',  radius: 12, ringSpacing: 16, hue: 0.70, hueObjects: 0.66, lineIntensity: 0.8, fog: 0.004, speed: 14, objectFamily: 'esferas',   objectSize: 3,   spawnPerBeat: 1, particles: 5000 },
};
export const ACT_NAMES = Object.keys(ACTS);
const FAMILIES = ['poliedros', 'aros', 'cristales', 'paneles', 'esferas'];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class TrackScene extends BaseScene {
  static id = 'track';
  constructor(app) {
    super(app, 'track', 'Track');
    this.dist = 0;
    this.beatClock = 0;
    this.beatCount = 0;
    this.pulse = 0;
    this.flash = 0;
    this.look = new THREE.Vector2();
    this.lookTarget = new THREE.Vector2();
    this.roll = 0;
    this.objects = [];
    this.gates = [];
    this.hover = null;
    this.rebuildTunnel = false;
    this.gateCount = 0;
    this.tween = null;   // transición entre actos
    this.camera.near = 0.1; this.camera.far = 600;
  }

  defineParams() {
    this.p('speed', { min: 0, max: 80, default: 18, step: 0.1, label: 'velocidad (m/s)' });
    this.p('reverse', { default: false, label: 'sentido inverso' });
    this.p('fov', { min: 50, max: 120, default: 85, step: 0.5, label: 'fov' });
    this.p('lookRange', { min: 0, max: 70, default: 30, step: 0.5, label: 'rango de mirada (°)' });
    this.p('roll', { min: 0, max: 3, default: 1, step: 0.01, label: 'inclinación en curvas' });
    this.p('radius', { min: 2, max: 14, default: 5, step: 0.1, label: 'radio del túnel' });
    this.p('shape', { type: 'option', options: ['square', 'octagon', 'circle'], default: 'square', label: 'sección' });
    this.p('ringSpacing', { min: 2, max: 16, default: 4, step: 0.5, label: 'anillos cada (m)' });
    this.p('hue', { min: 0, max: 1, default: 0.62, step: 0.001, label: 'color túnel' });
    this.p('hueObjects', { min: 0, max: 1, default: 0.55, step: 0.001, label: 'color objetos' });
    this.p('lineIntensity', { min: 0.2, max: 8, default: 2.2, step: 0.01, label: 'intensidad neón' });
    this.p('fog', { min: 0, max: 0.08, default: 0.012, step: 0.0005, label: 'niebla' });
    this.p('bpm', { min: 40, max: 200, default: 120, step: 0.5, label: 'bpm' });
    this.p('autoBeat', { default: true, label: 'reloj de beats interno' });
    this.p('audioReact', { min: 0, max: 3, default: 1, step: 0.01, label: 'reacción al audio' });
    this.p('pulse', { min: 0, max: 1, default: 0, step: 0.001, label: 'pulso (asignable)' });
    this.p('beat', { type: 'trigger', label: 'beat' });
    this.p('hit', { type: 'trigger', label: 'activar objeto central' });
    this.p('spawnPerBeat', { min: 0, max: 4, default: 1, step: 1, label: 'objetos por beat' });
    this.p('gateEvery', { min: 1, max: 16, default: 4, step: 1, label: 'portal cada N beats' });
    this.p('objectSize', { min: 0.2, max: 4, default: 1, step: 0.01, label: 'tamaño objetos' });
    this.p('objectSpin', { min: 0, max: 4, default: 1, step: 0.01, label: 'giro objetos' });
    this.p('particles', { min: 0, max: 6000, default: 1500, step: 100, label: 'partículas' });
    this.p('bodyMetal', { min: 0, max: 1, default: 0.7, step: 0.01, label: 'metal cuerpos' });
    this.p('objectFamily', { type: 'option', options: FAMILIES, default: 'poliedros', label: 'familia de objetos' });
    this.p('act', { type: 'option', options: ACT_NAMES, default: 'lineas', label: 'acto' });
    this.p('nextAct', { type: 'trigger', label: 'siguiente acto' });
    this.p('actsAuto', { default: true, label: 'cambiar de acto en portales' });
    this.p('actEveryGates', { min: 1, max: 16, default: 4, step: 1, label: 'portales por acto' });
    this.p('actFade', { min: 0.2, max: 6, default: 2, step: 0.1, label: 'transición (s)' });
  }

  // ---------- circuito ----------
  buildPath() {
    const rnd = mulberry(7);
    const pts = [];
    const n = 14, R = 170;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = R * (0.75 + 0.5 * rnd());
      pts.push(new THREE.Vector3(Math.cos(a) * r, (rnd() - 0.5) * 60, Math.sin(a) * r));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    // tabla de posiciones / marcos por transporte paralelo (evita torsiones)
    const pos = [], tan = [], nor = [], bin = [];
    for (let i = 0; i < TABLE_N; i++) {
      const u = i / TABLE_N;
      pos.push(this.curve.getPointAt(u));
      tan.push(this.curve.getTangentAt(u).normalize());
    }
    // "arriba" del mundo proyectado sobre el plano perpendicular a la tangente:
    // el piso del túnel queda siempre abajo y no hay torsión en la costura del circuito
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < TABLE_N; i++) {
      const n = up.clone().sub(_v1.copy(tan[i]).multiplyScalar(up.dot(tan[i]))).normalize();
      nor.push(n);
      bin.push(new THREE.Vector3().crossVectors(tan[i], n).normalize());
    }
    this.table = { pos, tan, nor, bin };
  }

  /** Marco (posición, tangente, normal, binormal) a una distancia s sobre el circuito. */
  frameAt(s, out = {}) {
    const N = TABLE_N, t = this.table;
    const u = (((s / this.length) % 1) + 1) % 1;
    const f = u * N, i = Math.floor(f) % N, j = (i + 1) % N, k = f - Math.floor(f);
    out.pos = (out.pos || new THREE.Vector3()).lerpVectors(t.pos[i], t.pos[j], k);
    out.tan = (out.tan || new THREE.Vector3()).lerpVectors(t.tan[i], t.tan[j], k).normalize();
    out.nor = (out.nor || new THREE.Vector3()).lerpVectors(t.nor[i], t.nor[j], k).normalize();
    out.bin = (out.bin || new THREE.Vector3()).crossVectors(out.tan, out.nor).normalize();
    return out;
  }

  sides() { const s = this.v('shape'); return s === 'square' ? 4 : s === 'octagon' ? 8 : 32; }

  buildTunnel() {
    if (this.rings) { this.scene.remove(this.rings, this.rails, this.occluder); this.rings.geometry.dispose(); this.rails.geometry.dispose(); this.occluder.geometry.dispose(); }
    const radius = this.v('radius'), spacing = this.v('ringSpacing'), sides = this.sides();
    const count = Math.max(8, Math.floor(this.length / spacing));
    const ringPts = [], railPts = [];
    const f = {}, prev = [];
    const a0 = sides === 4 ? Math.PI / 4 : 0;
    for (let i = 0; i <= count; i++) {
      this.frameAt((i / count) * this.length, f);
      const cur = [];
      for (let k = 0; k < sides; k++) {
        const a = a0 + (k / sides) * Math.PI * 2;
        cur.push(f.pos.clone().addScaledVector(f.nor, Math.cos(a) * radius).addScaledVector(f.bin, Math.sin(a) * radius));
      }
      if (i < count) for (let k = 0; k < sides; k++) ringPts.push(cur[k], cur[(k + 1) % sides]);
      if (i > 0) for (let k = 0; k < sides; k++) railPts.push(prev[k], cur[k]);
      prev.length = 0; prev.push(...cur);
    }
    const mk = (pts, mat) => { const g = new THREE.BufferGeometry().setFromPoints(pts); const l = new THREE.LineSegments(g, mat); l.frustumCulled = false; return l; };
    this.rings = mk(ringPts, this.ringMat); this.rails = mk(railPts, this.railMat);
    this.occluder = new THREE.Mesh(new THREE.TubeGeometry(this.curve, 600, radius * 1.25, 8, true), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    this.scene.add(this.rings, this.rails, this.occluder);
  }

  buildParticles() {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    const n = Math.round(this.v('particles'));
    this.pData = [];
    const rnd = mulberry(99);
    for (let i = 0; i < n; i++) this.pData.push({ s: rnd() * 120, a: rnd() * Math.PI * 2, r: 0.3 + rnd() * 0.65 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.points = new THREE.Points(geo, this.pointMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x000000);
    s.fog = new THREE.FogExp2(0x000000, 0.012);
    this.buildPath();

    this.ringMat = new THREE.LineBasicMaterial({ color: 0x2255ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.railMat = new THREE.LineBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx = cv.getContext('2d'); const grad = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = grad; cx.fillRect(0, 0, 64, 64);
    this.sprite = new THREE.CanvasTexture(cv);
    this.pointMat = new THREE.PointsMaterial({ color: 0x88aaff, size: 0.05, sizeAttenuation: true, map: this.sprite, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.buildTunnel();
    this.buildParticles();

    // luces: ambiente muy bajo + una luz que viaja con la cámara
    s.add(new THREE.AmbientLight(0x223355, 0.6));
    this.camLight = new THREE.PointLight(0x4477ff, 60, 60, 1.5);
    s.add(this.camLight);

    // objetos: cuerpo oscuro + bordes neón
    const fam = (geos) => geos.map((geo) => ({ geo, edges: new THREE.EdgesGeometry(geo, 20) }));
    this.families = {
      poliedros: fam([new THREE.IcosahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.TetrahedronGeometry(1.3, 0), new THREE.DodecahedronGeometry(1, 0), new THREE.CylinderGeometry(0.7, 0.7, 1.6, 6), new THREE.TorusKnotGeometry(0.7, 0.22, 48, 6)]),
      aros: fam([new THREE.TorusGeometry(1.6, 0.12, 6, 24), new THREE.TorusGeometry(1.1, 0.2, 6, 16), new THREE.TorusGeometry(2.2, 0.08, 4, 32), new THREE.RingGeometry(1.2, 1.6, 8, 1)]),
      cristales: fam([new THREE.ConeGeometry(0.35, 4, 5), new THREE.CylinderGeometry(0.15, 0.4, 5, 6), new THREE.OctahedronGeometry(1, 0).scale(0.4, 2.5, 0.4), new THREE.TetrahedronGeometry(1, 0).scale(0.5, 3, 0.5)]),
      paneles: fam([new THREE.BoxGeometry(2.4, 1.4, 0.06), new THREE.BoxGeometry(1.2, 2.6, 0.06), new THREE.BoxGeometry(3, 0.5, 0.06), new THREE.PlaneGeometry(1.8, 1.8)]),
      esferas: fam([new THREE.IcosahedronGeometry(1, 2), new THREE.SphereGeometry(1, 12, 8), new THREE.IcosahedronGeometry(1.4, 1)]),
    };
    this.types = this.families.poliedros;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.3, metalness: 0.7 });
    for (let i = 0; i < 48; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.types[0].geo, this.bodyMat);
      const edges = new THREE.LineSegments(this.types[0].edges, new THREE.LineBasicMaterial({ color: 0x44aaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(body, edges); g.visible = false;
      s.add(g);
      this.objects.push({ g, body, edges, active: false, s: 0, spin: new THREE.Vector3(), vel: new THREE.Vector3(), flash: 0, boost: 0 });
    }
    // portales
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const outer = new THREE.LineLoop(new THREE.BufferGeometry(), mat), inner = new THREE.LineLoop(new THREE.BufferGeometry(), mat), spokes = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      g.add(outer, inner, spokes); g.visible = false; s.add(g);
      this.gates.push({ g, outer, inner, spokes, mat, active: false, s: 0, passed: false, flash: 0 });
    }

    this.params.onChange((id) => {
      if (id === 'track.beat') this.onBeat(true);
      if (id === 'track.hit') this.activate(this.hover);
      if (id === 'track.radius' || id === 'track.shape' || id === 'track.ringSpacing') this.rebuildTunnel = true;
      if (id === 'track.particles') this.buildParticles();
      if (id === 'track.objectFamily') this.types = this.families[this.params.get('track.objectFamily')] || this.families.poliedros;
      if (id === 'track.act') this.startAct(this.params.get('track.act'));
      if (id === 'track.nextAct') this.nextAct();
    });
    this.actApplied = null;
    this.types = this.families[this.v('objectFamily')] || this.families.poliedros;
    if (this.v('act') !== 'lineas') this.startAct(this.v('act'));
    for (let i = 0; i < 12; i++) this.spawnObject(20 + i * 12);
  }

  // ---------- eventos ----------
  onPointerMove(x, y) { this.lookTarget.set(x, y); }
  onPointerDown() { this.activate(this.hover); }

  dir() { return this.v('reverse') ? -1 : 1; }

  onBeat(force = false) {
    this.beatCount++;
    this.pulse = 1;
    const n = force ? Math.max(1, this.v('spawnPerBeat')) : this.v('spawnPerBeat');
    for (let i = 0; i < n; i++) this.spawnObject(60 + Math.random() * 40);
    if (this.beatCount % Math.max(1, Math.round(this.v('gateEvery'))) === 0) this.spawnGate(90);
  }

  spawnObject(ahead) {
    const o = this.objects.find((x) => !x.active);
    if (!o) return;
    const type = this.types[Math.floor(Math.random() * this.types.length)];
    o.body.geometry = type.geo; o.edges.geometry = type.edges;
    o.s = this.dist + this.dir() * ahead;
    const f = this.frameAt(o.s);
    const r = this.v('radius') * (0.15 + Math.random() * 0.6), a = Math.random() * Math.PI * 2;
    o.g.position.copy(f.pos).addScaledVector(f.nor, Math.cos(a) * r).addScaledVector(f.bin, Math.sin(a) * r);
    o.g.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    o.g.scale.setScalar(this.v('objectSize') * (0.5 + Math.random() * 1.2));
    o.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2);
    o.vel.set(0, 0, 0); o.flash = 0; o.boost = 0; o.active = true; o.g.visible = true;
  }

  spawnGate(ahead) {
    const gt = this.gates.find((x) => !x.active);
    if (!gt) return;
    gt.s = this.dist + this.dir() * ahead;
    const f = this.frameAt(gt.s);
    const sides = this.sides(), radius = this.v('radius'), a0 = sides === 4 ? Math.PI / 4 : 0;
    const ring = (rr) => { const pts = []; for (let k = 0; k < sides; k++) { const a = a0 + (k / sides) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0)); } return pts; };
    const outer = ring(radius * 0.97), inner = ring(radius * 0.8);
    gt.outer.geometry.dispose(); gt.inner.geometry.dispose(); gt.spokes.geometry.dispose();
    gt.outer.geometry = new THREE.BufferGeometry().setFromPoints(outer);
    gt.inner.geometry = new THREE.BufferGeometry().setFromPoints(inner);
    const sp = []; for (let k = 0; k < sides; k += Math.max(1, Math.floor(sides / 8))) sp.push(outer[k], inner[k]);
    gt.spokes.geometry = new THREE.BufferGeometry().setFromPoints(sp);
    gt.g.position.copy(f.pos);
    gt.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.nor, f.bin, f.tan));
    gt.active = true; gt.passed = false; gt.flash = 0.3; gt.g.visible = true;
  }

  activate(o) {
    if (!o || !o.active) return;
    o.flash = 1; o.boost = 6;
    const f = this.frameAt(o.s);
    _v1.subVectors(o.g.position, f.pos); if (_v1.lengthSq() < 1e-4) _v1.copy(f.nor);
    o.vel.copy(_v1.normalize().multiplyScalar(4)).addScaledVector(f.tan, this.dir() * 6);
    this.flash = 1;
  }

  // ---------- actos ----------
  nextAct() {
    const i = (ACT_NAMES.indexOf(this.v('act')) + 1) % ACT_NAMES.length;
    this.params.set('track.act', ACT_NAMES[i], 'act');
  }

  /** Arranca la transición hacia un acto: los numéricos se interpolan, el resto se aplica en el pico del destello. */
  startAct(name) {
    const preset = ACTS[name];
    if (!preset || this.actApplied === name) return;
    this.actApplied = name;
    this.flash = Math.max(this.flash, 1);
    const from = {}, to = {}, discrete = {};
    for (const [k, val] of Object.entries(preset)) {
      const d = this.params.def(`track.${k}`);
      if (!d) continue;
      if (d.type === 'number') { from[k] = d.value; to[k] = val; } else discrete[k] = val;
    }
    this.tween = { t: 0, dur: Math.max(0.2, this.v('actFade')), from, to, discrete, applied: false };
  }

  updateTween(dt) {
    const tw = this.tween;
    if (!tw) return;
    tw.t = Math.min(tw.dur, tw.t + dt);
    const k = tw.t / tw.dur, e = k * k * (3 - 2 * k);
    if (!tw.applied && k >= 0.35) {
      for (const [key, val] of Object.entries(tw.discrete)) this.params.set(`track.${key}`, val, 'act');
      tw.applied = true;
    }
    for (const key of Object.keys(tw.to)) {
      if (key === 'particles') continue; // se aplica de golpe al final (reconstruye)
      this.params.set(`track.${key}`, tw.from[key] + (tw.to[key] - tw.from[key]) * e, 'act');
    }
    if (tw.t >= tw.dur) { if ('particles' in tw.to) this.params.set('track.particles', tw.to.particles, 'act'); this.tween = null; }
  }

  // ---------- frame ----------
  update(dt, t) {
    const v = (n) => this.v(n);
    if (this.rebuildTunnel) { this.buildTunnel(); this.rebuildTunnel = false; }
    this.updateTween(dt);
    const dir = this.dir();
    this.dist += v('speed') * dt * dir;

    // beats: reloj interno, audio o trigger externo
    const audio = this.app.audio;
    if (v('autoBeat')) { this.beatClock += (dt * v('bpm')) / 60; if (this.beatClock >= 1) { this.beatClock -= 1; this.onBeat(); } }
    if (audio?.beat && v('audioReact') > 0 && !v('autoBeat')) this.onBeat();
    const bass = audio?.active ? audio.smooth.bass * v('audioReact') : 0;
    this.pulse = Math.max(this.pulse - dt * 2.5, bass, v('pulse'));
    this.flash = Math.max(0, this.flash - dt * 3);

    // cámara sobre el circuito
    const f = this.frameAt(this.dist, this.cf || (this.cf = {}));
    const cam = this.camera;
    cam.position.copy(f.pos).addScaledVector(f.nor, -v('radius') * 0.12);
    cam.up.copy(f.nor);
    cam.lookAt(_v1.copy(f.pos).addScaledVector(f.tan, dir * 10));
    this.look.lerp(this.lookTarget, 1 - Math.exp(-dt * 4));
    const range = THREE.MathUtils.degToRad(v('lookRange'));
    // inclinación según la curva que viene
    const ahead = this.frameAt(this.dist + dir * 25, this.af || (this.af = {}));
    const curv = _v2.subVectors(ahead.tan, f.tan).dot(f.bin) * dir;
    const targetRoll = THREE.MathUtils.clamp(-curv * v('roll') * 0.6, -0.4, 0.4);
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 2));
    cam.rotateY(-this.look.x * range);
    cam.rotateX(this.look.y * range * 0.6);
    cam.rotateZ(this.roll);
    cam.fov = v('fov');
    this.camLight.position.copy(cam.position);
    this.scene.fog.density = v('fog');

    // colores
    const intensity = v('lineIntensity') * (1 + this.pulse * 0.9) + this.flash * 2;
    this.ringMat.color.setHSL(v('hue'), 1, 0.5).multiplyScalar(intensity * 0.6);
    this.railMat.color.setHSL(v('hue'), 0.9, 0.6).multiplyScalar(intensity);
    this.pointMat.color.setHSL(v('hue'), 0.7, 0.7).multiplyScalar(intensity * 0.5);
    this.bodyMat.metalness = v('bodyMetal');
    this.camLight.color.setHSL(v('hue'), 0.8, 0.6);

    // objetos
    cam.getWorldDirection(_v3);
    let best = null, bestAng = 0.3;
    for (const o of this.objects) {
      if (!o.active) continue;
      const rel = (o.s - this.dist) * dir;
      if (rel < -25 || rel > 400) { o.active = false; o.g.visible = false; continue; }
      const spin = v('objectSpin') + o.boost;
      o.g.rotation.x += o.spin.x * spin * dt; o.g.rotation.y += o.spin.y * spin * dt; o.g.rotation.z += o.spin.z * spin * dt;
      o.g.position.addScaledVector(o.vel, dt); o.vel.multiplyScalar(Math.exp(-dt * 0.8));
      o.boost = Math.max(0, o.boost - dt * 3); o.flash = Math.max(0, o.flash - dt * 1.5);
      _v1.subVectors(o.g.position, cam.position);
      const d = _v1.length(), ang = Math.acos(THREE.MathUtils.clamp(_v1.divideScalar(d).dot(_v3), -1, 1));
      if (rel > 2 && d < 90 && ang < bestAng) { bestAng = ang; best = o; }
      const near = THREE.MathUtils.smoothstep(d, 0, 12);
      o.edges.material.color.setHSL(v('hueObjects') + o.flash * 0.1, 1 - o.flash, 0.55 + o.flash * 0.45).multiplyScalar(intensity * (0.5 + 0.6 * near) * (1 + o.flash * 3));
    }
    this.hover = best;
    if (best) best.edges.material.color.multiplyScalar(1.8);

    // portales
    for (const gt of this.gates) {
      if (!gt.active) continue;
      const rel = (gt.s - this.dist) * dir;
      if (rel < -30) { gt.active = false; gt.g.visible = false; continue; }
      if (!gt.passed && rel < 0) {
        gt.passed = true; gt.flash = 1; this.flash = Math.max(this.flash, 0.6);
        this.gateCount++;
        if (v('actsAuto') && this.gateCount % Math.max(1, Math.round(v('actEveryGates'))) === 0) this.nextAct();
      }
      gt.flash = Math.max(0, gt.flash - dt * 2);
      gt.mat.color.setHSL(v('hue') + 0.1, 0.8, 0.6 + gt.flash * 0.4).multiplyScalar(intensity * (0.7 + gt.flash * 3));
    }

    // partículas que pasan de largo
    if (this.pData.length) {
      const arr = this.points.geometry.attributes.position.array;
      const radius = v('radius'), pf = this.pf || (this.pf = {});
      for (let i = 0; i < this.pData.length; i++) {
        const p = this.pData[i];
        let rel = (p.s - this.dist) * dir;
        if (rel < -5) { p.s += dir * 120; rel += 120; } else if (rel > 125) { p.s -= dir * 120; }
        this.frameAt(p.s, pf);
        const x = pf.pos.x + (pf.nor.x * Math.cos(p.a) + pf.bin.x * Math.sin(p.a)) * p.r * radius;
        const y = pf.pos.y + (pf.nor.y * Math.cos(p.a) + pf.bin.y * Math.sin(p.a)) * p.r * radius;
        const z = pf.pos.z + (pf.nor.z * Math.cos(p.a) + pf.bin.z * Math.sin(p.a)) * p.r * radius;
        arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.pointMat.size = 0.04 + this.pulse * 0.04;
    }
  }
}
