import * as THREE from 'three';
import { MusicScene, BAND_HUES } from './MusicScene.js';
import { WetFloor } from '../../stage/WetFloor.js';

/**
 * ÁRBOL: el tema crece como un árbol a lo largo del tiempo.
 *
 *  tronco     sigue la grilla de beats (nodo por beat, más grande en el
 *             downbeat); su grosor respira con el sub. Cada sección tiene su
 *             carril y su color: al cambiar de sección el tronco se bifurca a
 *             otro carril; cuando vuelve el estribillo vuelve al mismo carril.
 *  ramas      un golpe por banda: los kicks quedan sobre el tronco (anillos
 *             que se expanden), los graves-medios cerca, los medios más lejos,
 *             agudos y aire ramifican lo más afuera. El largo es la fuerza;
 *             los golpes fuertes estallan en ramitas.
 *  futuro     como todo el tema ya está analizado, lo que viene se ve venir:
 *             puntos tenues delante del "ahora" marcan los próximos golpes y
 *             la rama crece hacia el lugar exacto donde va a caer. Al caer,
 *             destella. En estéreo lo que viene sale del mural hacia el público.
 *  notas      (modo MIDI) puntos de color por clase de altura al costado.
 */
const PAST_BEATS = 24;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);
const BAND_R = [0.0, 0.55, 1.1, 1.7, 2.3];        // distancia radial de la punta por banda
const BAND_LEN = [0.25, 0.6, 1.0, 1.3, 1.6];      // largo máximo de la rama

export class ArbolScene extends MusicScene {
  static id = 'arbol';
  static title = 'Árbol';
  constructor(app) { super(app, 'arbol', 'Árbol'); }

  defineParams() {
    super.defineParams();
    this.p('carriles', { min: 0, max: 4, default: 1.6, step: 0.01, label: 'separación entre carriles' });
    this.p('grosor', { min: 0.02, max: 0.6, default: 0.1, step: 0.005, label: 'grosor del tronco' });
    this.p('ramas', { min: 0, max: 3, default: 1, step: 0.01, label: 'largo de ramas' });
    this.p('anillos', { min: 0, max: 2, default: 1, step: 0.01, label: 'anillos de los kicks' });
    this.p('pasado', { min: 4, max: 64, default: 24, step: 1, label: 'beats visibles hacia atrás' });
    this.p('brillo', { min: 0, max: 3, default: 0.9, step: 0.01, label: 'brillo' });
    this.p('niebla', { min: 0, max: 0.2, default: 0.045, step: 0.001, label: 'niebla' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x03020a);
    s.fog = new THREE.FogExp2(0x03020a, 0.035);
    this.light = new THREE.PointLight(0xffffff, 40, 0, 1.4); this.light.position.set(0, 4, 4); s.add(this.light);
    s.add(new THREE.AmbientLight(0x404060, 0.5));
    const lit = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.15 });
    const glow = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
    // tronco: cilindros por segmento de beat
    this.trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), lit(), 96); this.trunk.name = 'tronco';
    this.nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), glow(), 96); this.nodes.name = 'nodos (beats)';
    this.branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), glow(), 900); this.branches.name = 'ramas';
    this.tips = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), glow(), 900); this.tips.name = 'puntas';
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), 64); this.rings.name = 'anillos (kicks)';
    this.notes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), 600); this.notes.name = 'notas';
    for (const m of [this.trunk, this.nodes, this.branches, this.tips, this.rings, this.notes]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; s.add(m); }
    // piso de referencia muy tenue (ayuda a leer la profundidad en estéreo)
    this.floor = new WetFloor({ size: 70, repeat: 10, puddles: 0.4, reflect: 0.75, color: 0x9aa0b0 }); this.floor.position.y = -3.2; this.floor.userData.helper = true; s.add(this.floor);
    this.subject.radius = 4; this.subject.distance = 10;
    this.fixed = { pos: new THREE.Vector3(6.5, 4.2, 5.5), look: new THREE.Vector3(0, -0.3, -4), fov: 36 };
  }

  /** Carril (x) de una sección: cada tipo tiene el suyo, alternando a izquierda y derecha. */
  laneX(type) { const k = Math.ceil(type / 2) * (type % 2 ? 1 : -1); return k * this.v('carriles'); }

  /** Posición del tronco en un instante t (con la bifurcación suave entre secciones). */
  trunkPos(t, out) {
    const c = this.cues, sec = c.sectionAt ? c.sectionAt(t) : c.section;
    let x = this.laneX(sec?.type ?? 0);
    if (sec && t - sec.t0 < c.beatDur * 2) {   // la bifurcación dura 2 beats
      const prev = c.sections?.[sec.index - 1];
      if (prev) { const k = THREE.MathUtils.smoothstep((t - sec.t0) / (c.beatDur * 2), 0, 1); x = this.laneX(prev.type) + (x - this.laneX(prev.type)) * k; }
    }
    return out.set(x, Math.sin(t * 0.7) * 0.15, this.zOf(t));
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), L = this.lookahead, now = c.t, bl = this.beatLen;
    const past = v('pasado'), bright = v('brillo'), k = this.v2('fourier.intensidad');
    const t0 = now - past * c.beatDur, t1 = now + L;
    this.scene.fog.density = v('niebla');

    // ---------- tronco y nodos ----------
    const beats = c.beatsBetween(t0 - c.beatDur, t1 + c.beatDur);
    let ti = 0, ni = 0;
    const A = this.app.music?.track?.analysis;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i], nb = beats[i + 1];
      const sec = c.sectionAt(b.t); const col = this.sectionColor(sec.type, 0.55);
      const future = b.t > now, dist = Math.abs(b.t - now);
      const fade = future ? 0.25 + 0.75 * Math.max(0, 1 - dist / L) : 1;
      // segmento hacia el próximo beat
      if (nb && ti < this.trunk.count + 1 && ti < 96) {
        const a = this.trunkPos(b.t, _v).clone(), e = this.trunkPos(nb.t, _s).clone();
        const mid = a.clone().lerp(e, 0.5), dir = e.clone().sub(a), len = dir.length();
        // grosor: sub en ese instante (del análisis) o la envolvente actual
        let sub = c.bands[0].env; if (A) { const f = Math.min(A.nFrames - 1, Math.max(0, Math.round(b.t * A.fps))); sub = A.bands[0].env[f]; }
        const r = v('grosor') * (0.6 + 0.8 * sub) * (future ? 0.5 : 1);
        _q.setFromUnitVectors(_up, dir.normalize());
        _m.compose(mid, _q, _s.set(r, len, r));
        this.trunk.setMatrixAt(ti, _m); this.trunk.setColorAt(ti, _c.copy(col).multiplyScalar(fade * (0.7 + 0.6 * sub))); ti++;
      }
      // nodo
      const pos = this.trunkPos(b.t, _v);
      const near = Math.max(0, 1 - dist / (c.beatDur * 0.5));
      const size = v('grosor') * (b.downbeat ? 2.4 : 1.5) * (1 + near * 0.6 * k) * (future ? 0.7 : 1);
      _m.compose(pos, _q.identity(), _s.set(size, size, size));
      this.nodes.setMatrixAt(ni, _m); this.nodes.setColorAt(ni, _c.copy(col).multiplyScalar((0.45 + near * 1.2 * k) * fade * bright)); ni++;
    }
    this.trunk.count = ti; this.nodes.count = ni;

    // ---------- ramas, puntas, anillos ----------
    let bi = 0, ri = 0;
    const thr = this.threshold, ramas = v('ramas');
    for (let band = 0; band < 5; band++) {
      const ons = c.onsetsBetween(band, t0, t1);
      const hue = this.hue(BAND_HUES[band]);
      for (const o of ons) {
        if (o.s < thr * (1 + band * 0.35) || bi >= 900) continue;   // las bandas altas tienen muchos más golpes: se les pide más fuerza
        const base = this.trunkPos(o.t, _v).clone();
        const future = o.t > now, until = o.t - now;
        // crecimiento: en el futuro la rama crece hacia la punta; en el pasado está completa
        const grow = future ? Math.pow(Math.max(0, 1 - until / L), 1.6) : 1;
        const flash = Math.max(0, 1 - Math.abs(now - o.t) / 0.25);
        // dirección: ángulo fijo por golpe (semilla = tiempo) dentro del sector de la banda
        const seed = Math.sin(o.t * 913.7) * 0.5 + 0.5;
        const ang = (band * 1.26 + seed * 1.1 + (band % 2 ? 0 : Math.PI)) % (Math.PI * 2);
        const rad = (BAND_R[band] + BAND_LEN[band] * o.s * ramas) * (band === 0 ? 0.3 : 1);
        const tip = base.clone().add(new THREE.Vector3(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.8 + rad * 0.25, 0));
        const col = _c.setHSL(hue, 0.9, 0.55 + flash * 0.4);
        const alpha = (future ? 0.25 + 0.75 * grow : 1) * bright;
        if (band > 0 && grow > 0.02) {
          const end = base.clone().lerp(tip, grow), dir = end.clone().sub(base), len = dir.length() || 0.001;
          _q.setFromUnitVectors(_up, dir.normalize());
          const r = 0.006 + 0.022 * o.s;
          _m.compose(base.clone().lerp(end, 0.5), _q, _s.set(r, len, r));
          this.branches.setMatrixAt(bi, _m); this.branches.setColorAt(bi, _c.clone().multiplyScalar(alpha * (0.35 + flash * 0.8)));
        } else { _m.compose(base, _q.identity(), _s.set(0.0001, 0.0001, 0.0001)); this.branches.setMatrixAt(bi, _m); }
        // punta: tenue como "punto que viene", llena al caer
        const ts = (0.03 + 0.09 * o.s) * (future ? 0.5 + 0.5 * grow : 1) * (1 + flash * 1.5 * k);
        _m.compose(future ? tip : tip, _q.identity(), _s.set(ts, ts, ts));
        this.tips.setMatrixAt(bi, _m); this.tips.setColorAt(bi, _c.clone().multiplyScalar((future ? 0.3 + 0.7 * grow : 0.9) * (0.6 + flash * 1.6 * k) * bright));
        bi++;
        // anillos de los kicks: se expanden al caer
        if (band === 0 && !future && ri < 64 && now - o.t < 1.2 && v('anillos') > 0) {
          const age = now - o.t, rr = (0.3 + age * 2.2 * o.s) * v('anillos');
          _q.setFromUnitVectors(_up, new THREE.Vector3(0, 0, 1));
          _m.compose(base, _q, _s.set(rr, rr, rr));
          this.rings.setMatrixAt(ri, _m); this.rings.setColorAt(ri, _c.setHSL(this.hue(0.0), 0.9, 0.6).multiplyScalar(Math.max(0, 1 - age / 1.2) * o.s * 1.5 * bright)); ri++;
        }
      }
    }
    this.branches.count = bi; this.tips.count = bi; this.rings.count = ri;

    // ---------- notas ----------
    let nn = 0;
    if (this.v2('fourier.notas')) {
      for (const n of c.notesBetween(t0, t1)) {
        if (nn >= 600 || n.vel < 0.4) continue;
        const base = this.trunkPos(n.t0, _v);
        const y = (n.midi - 60) / 12 * 1.2 + 1.6, future = n.t0 > now;
        const flash = Math.max(0, 1 - Math.abs(now - n.t0) / 0.3);
        const size = 0.03 + 0.06 * n.vel * (1 + flash);
        _m.compose(_s.set(base.x - 1.4, y, base.z), _q.identity(), new THREE.Vector3(size, size, size));
        this.notes.setMatrixAt(nn, _m); this.notes.setColorAt(nn, _c.setHSL(this.hue((n.midi % 12) / 12), 0.8, 0.6).multiplyScalar((future ? 0.3 : 0.8) * (1 + flash) * bright)); nn++;
      }
    }
    this.notes.count = nn;
    for (const m of [this.trunk, this.nodes, this.branches, this.tips, this.rings, this.notes]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    // sujeto para el director: el "ahora" sobre el tronco, mirando hacia el futuro
    this.trunkPos(now, this.subject.center); this.subject.center.z = 0;
    this.light.position.copy(this.subject.center).add(new THREE.Vector3(1.5, 3.5, 3));
    this.light.intensity = 25 + this.kick * 30;
    this.finish(dt);
  }
}
