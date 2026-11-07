import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { MusicScene } from './MusicScene.js';
import { WetFloor } from '../../stage/WetFloor.js';
import { Beam } from '../../stage/Beam.js';
import { makeMaterials, buildTruss, buildSilhouettes, canvasTex } from '../../stage/Set.js';
import { KaossEngine } from '../../stage/Kaoss.js';

/**
 * KAOSS ESTROBO: un club a oscuras con una pared de paneles estroboscópicos
 * LED (8 × 4), barras de píxeles a los costados, cabezas móviles en el truss
 * cortando el humo, piso mojado que lo refleja todo y el público a contraluz.
 *
 * Se toca como un Kaoss Pad (tecla Z, o el pad en otra ventana / tablet, o un
 * Kaoss Pad real por MIDI: CC12 X, CC13 Y, CC92 toque):
 *   X  velocidad cuantizada al beat (1/1 … 1/32)  ·  Y  color
 *   ◀ ▶ programa: estrobo, persecución, aleatorio, espejo, ola, tartamudeo,
 *       filtro, eco
 * Sin tocar, la música dispara sola (bombo blanco, caja damero, platillos
 * chispas, beat persecución, sección cegadora).
 *
 * El mismo motor (src/stage/Kaoss.js) mueve las luces reales del rig por
 * Art-Net cuando se toca el pad (parámetro luces.kaoss).
 *
 * ⚠ Luces estroboscópicas: el modo seguro (estrobo.seguro, activo por
 * defecto) limita los destellos de campo completo a 3 por segundo.
 */
const COLS = 8, ROWS = 4, HEADS = 8, BAR_PX = 36, BARS = [-8.7, -7.6, 7.6, 8.7];
const _c = new THREE.Color(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

function ledTexture() {
  // cara de un panel estroboscópico LED: grilla de puntos con lente
  return canvasTex(256, (n, m, x, y, size) => {
    const cx = ((x / size) * 16) % 1 - 0.5, cy = ((y / size) * 9) % 1 - 0.5, d = Math.hypot(cx, cy);
    const dot = Math.max(0, 1 - d / 0.42), v = Math.min(255, 18 + 237 * Math.pow(dot, 0.6) + n * 10);
    return [v, v, v];
  }, true);
}

export class KaossScene extends MusicScene {
  static id = 'estrobo';
  static title = 'Kaoss estrobo';
  constructor(app) {
    super(app, 'estrobo', 'Kaoss estrobo');
    this.showPad = true; this.lastRate = '';
    this.look = { 'look.bloom': 1.0, 'look.bloomThreshold': 0.75, 'look.bloomRadius': 0.6, 'look.exposure': 1, 'fx.vineta': 0.5, 'fx.grano': 0.08, 'fx.contraste': 1.15, 'fx.saturacion': 1.08, 'fx.tinte': 0 };
    this.padLabels = { title: 'Kaoss · luces', x: 'velocidad 1/1 → 1/32', y: 'color: blanco → arcoíris', programs: true };
  }

  defineParams() {
    super.defineParams();
    this.p('humo', { min: 0, max: 2, default: 1, step: 0.01, label: 'humo (haces)' });
    this.p('paneles', { min: 0, max: 3, default: 1, step: 0.01, label: 'brillo de los paneles' });
    this.p('cabezas', { min: 0, max: 3, default: 1, step: 0.01, label: 'cabezas móviles' });
    this.p('publico', { default: true, label: 'público a contraluz' });
    this.p('reflejo', { min: 0, max: 1, default: 0.85, step: 0.01, label: 'reflejo del piso' });
  }

  build() {
    RectAreaLightUniformsLib.init();
    const s = this.scene, M = makeMaterials();
    s.background = new THREE.Color(0x020204);
    s.fog = new THREE.FogExp2(0x05060a, 0.028);

    // sala: pared del fondo y piso mojado
    const wall = new THREE.Mesh(new THREE.BoxGeometry(34, 13, 0.6), M.concrete); wall.position.set(0, 6.5, -6.4); wall.receiveShadow = true; s.add(wall);
    this.floor = new WetFloor({ size: 70, repeat: 12, puddles: 1.6, reflect: 0.85, color: 0x141518, textureWidth: 1024, textureHeight: 512 });
    s.add(this.floor);

    // pared de paneles: carcasas + caras LED (color por instancia, HDR para el bloom)
    const sx = 1.62, sy = 1.02, y0 = 1.55;
    this.panelPos = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) this.panelPos.push(new THREE.Vector3((i - (COLS - 1) / 2) * sx, y0 + j * sy, -5.95));
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.48, 0.9, 0.26), new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.7, roughness: 0.45 }), COLS * ROWS);
    this.faces = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.3, 0.72), new THREE.MeshBasicMaterial({ map: ledTexture(), color: 0xffffff }), COLS * ROWS);
    this.panelPos.forEach((p, k) => {
      housing.setMatrixAt(k, _m.makeTranslation(p.x, p.y, p.z));
      this.faces.setMatrixAt(k, _m.makeTranslation(p.x, p.y, p.z + 0.135));
      this.faces.setColorAt(k, _c.setRGB(0, 0, 0));
    });
    this.faces.instanceColor.setUsage(THREE.DynamicDrawUsage);
    s.add(housing, this.faces);
    // la pared ilumina la sala: 4 luces de área (una por cuadrante) con el color promedio de sus paneles
    this.quads = [0, 1, 2, 3].map((q) => {
      const l = new THREE.RectAreaLight(0xffffff, 0, (COLS / 2) * sx, (ROWS / 2) * sy);
      l.position.set((q % 2 ? 1 : -1) * (COLS / 4) * sx, y0 + (q < 2 ? 0.5 : 2.5) * sy, -5.7); l.lookAt(l.position.x, l.position.y, 10); s.add(l);
      return l;
    });

    // barras de píxeles a los costados
    this.barPx = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.12, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }), BARS.length * BAR_PX);
    let k = 0;
    for (const x of BARS) for (let i = 0; i < BAR_PX; i++) { this.barPx.setMatrixAt(k, _m.makeTranslation(x, 0.4 + i * 0.15, -4.6)); this.barPx.setColorAt(k++, _c.setRGB(0, 0, 0)); }
    this.barPx.instanceColor.setUsage(THREE.DynamicDrawUsage); s.add(this.barPx);
    for (const x of BARS) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, BAR_PX * 0.15 + 0.1, 0.1), M.dark); b.position.set(x, 0.4 + BAR_PX * 0.075 - 0.07, -4.65); s.add(b); }

    // truss y cabezas móviles con haz volumétrico + spot al piso
    s.add(buildTruss(M, 17, 6.9, -3.4));
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1b20, metalness: 0.6, roughness: 0.4 });
    this.heads = Array.from({ length: HEADS }, (_, i) => {
      const x = (i - (HEADS - 1) / 2) * 1.85, g = new THREE.Group(); g.position.set(x, 6.55, -3.4);
      const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.22), headMat); yoke.position.y = 0.18; g.add(yoke);
      const pan = new THREE.Group(); g.add(pan);
      const tilt = new THREE.Group(); pan.add(tilt);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.42, 16), headMat); tilt.add(body);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), new THREE.MeshBasicMaterial({ color: 0xffffff })); lens.rotation.x = Math.PI / 2; lens.position.y = -0.215; tilt.add(lens);
      s.add(g);
      const beam = new Beam({ angle: 0.075, length: 16, haze: 0.6, falloff: 0.006, intensity: 1 }); s.add(beam);
      const spot = new THREE.SpotLight(0xffffff, 0, 0, 0.12, 0.45, 2); spot.position.copy(g.position); s.add(spot, spot.target);
      return { g, pan, tilt, lens, beam, spot, pose: { pan: 0, tilt: 0.5 }, cur: { pan: 0, tilt: 0.5 } };
    });

    // público a contraluz
    const spots = [];
    for (let i = 0; i < 16; i++) spots.push([(Math.random() - 0.5) * 11, 0, 3 + Math.random() * 6.5, 1.6 + Math.random() * 0.3]);
    this.crowd = buildSilhouettes(M, spots);
    this.crowd.children.forEach((c) => { c.rotation.y = Math.PI + (Math.random() - 0.5) * 0.7; });
    s.add(this.crowd);
    s.add(new THREE.HemisphereLight(0x223040, 0x050505, 0.08));

    this.params.onChange((id, v) => { if (id === 'estrobo.publico') this.crowd.visible = v; if (id === 'estrobo.reflejo') this.floor.uniforms.reflectAmt.value = v; });
    this.fixed = { pos: new THREE.Vector3(0, 1.8, 12), look: new THREE.Vector3(0, 3.2, -6), fov: 37 };
    this.subject.radius = 7; this.subject.distance = 18;
  }

  enter() {
    super.enter();
    if (!this.warned) { this.warned = true; this.app.log?.('⚠ luces estroboscópicas: modo seguro activo (máx. 3 destellos/s de campo completo). Ver estrobo.seguro.'); }
  }

  update(dt, t) {
    const v = (n) => this.v(n);
    // el motor lo comparte la app (también mueve el rig real); el editor no lo tiene y usa uno propio
    let E = this.app.kaossLights;
    if (!E) { E = this.ownEngine ||= new KaossEngine(this.params); E.update(this.cues, dt, this.app.kaoss); E.setBands(this.cues.bands); }
    // rótulo del pad con la velocidad actual
    const pad = this.app.kaoss;
    if (pad && E.active && E.rateLabel !== this.lastRate) { this.lastRate = E.rateLabel; pad.setLabels({ ...this.padLabels, title: `Kaoss · luces · ${E.rateLabel}` }); }

    // paneles
    const pb = v('paneles') * 3.2, quad = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      E.sample(i / (COLS - 1), j / (ROWS - 1), _c);
      quad[(j < ROWS / 2 ? 0 : 2) + (i < COLS / 2 ? 0 : 1)].add(_c);
      this.faces.setColorAt(j * COLS + i, _c.multiplyScalar(pb));
    }
    this.faces.instanceColor.needsUpdate = true;
    const per = (COLS * ROWS) / 4;
    this.quads.forEach((l, q) => { const c = quad[q].multiplyScalar(1 / per); const I = Math.max(c.r, c.g, c.b); l.color.copy(c).multiplyScalar(1 / Math.max(I, 1e-3)); l.intensity = I * 8 * v("paneles"); });

    // barras de píxeles
    let k = 0;
    BARS.forEach((x, b) => {
      const u = b < 2 ? b * 0.06 : 0.94 + (b - 2) * 0.06;
      for (let i = 0; i < BAR_PX; i++) { E.sample(u, i / (BAR_PX - 1), _c); this.barPx.setColorAt(k++, _c.multiplyScalar(2.6)); }
    });
    this.barPx.instanceColor.needsUpdate = true;

    // cabezas: pose del programa, color de su columna
    const haze = v('humo'), hb = v('cabezas');
    this.heads.forEach((h, i) => {
      E.headPose(i, HEADS, h.pose);
      const glide = 1 - Math.exp(-dt * 9);
      h.cur.pan += (h.pose.pan - h.cur.pan) * glide; h.cur.tilt += (h.pose.tilt - h.cur.tilt) * glide;
      h.pan.rotation.y = h.cur.pan; h.tilt.rotation.x = -h.cur.tilt;
      // dirección del haz: hacia abajo, inclinada hacia el público (tilt) y girada (pan)
      const d = _v.set(Math.sin(h.cur.pan) * Math.sin(h.cur.tilt), -Math.cos(h.cur.tilt), Math.cos(h.cur.pan) * Math.sin(h.cur.tilt)).normalize();
      E.sample(i / (HEADS - 1), 1, _c);
      const I = Math.max(_c.r, _c.g, _c.b);
      const lensPos = h.g.position.clone().addScaledVector(d, 0.25);
      h.beam.position.copy(lensPos); h.beam.lookAt(lensPos.clone().add(d)); h.beam.sync(t);
      h.beam.set(_c.clone().multiplyScalar(1 / Math.max(I, 1e-3)), I * 1.4 * hb, 0.35 + 0.65 * haze);
      h.spot.position.copy(lensPos); h.spot.target.position.copy(lensPos).addScaledVector(d, 10);
      h.spot.color.copy(h.beam.material.uniforms.color.value); h.spot.intensity = I * 160 * hb;
      h.lens.material.color.copy(_c).multiplyScalar(2.5);
    });
    this.finish(dt);
  }
}
