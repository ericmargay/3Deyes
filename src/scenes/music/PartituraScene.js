import * as THREE from 'three';
import { MusicScene } from './MusicScene.js';
import { WetFloor } from '../../stage/WetFloor.js';
import { NOTE_LO, NOTE_HI } from '../../music/analysis.js';

/**
 * PARTITURA: el tema escrito como matemática.
 *
 * Cada nota transcripta se dibuja como un arco de seno: su ancho es la
 * duración, su altura la fuerza, su posición vertical la altura (pitch) y su
 * color la clase de altura (Do, Re, Mi… cada una con su tono: sinestesia
 * cromática). Pentagrama con los beats como barras (más altas en el
 * downbeat), secciones como corchetes de color, y la línea de lectura en el
 * "ahora": la nota que la cruza se enciende. Sobre la línea, una rosa polar
 * de 12 pétalos dibuja la armonía del instante (el croma): r = Σ c_k·cos²(6θ − k·π/6).
 * Abajo, el espectro del instante como curva.
 */
const PAST = 16, SEG = 14;
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class PartituraScene extends MusicScene {
  static id = 'partitura';
  static title = 'Partitura';
  constructor(app) { super(app, 'partitura', 'Partitura'); }

  defineParams() {
    super.defineParams();
    this.p('alturaNotas', { min: 0.2, max: 3, default: 1, step: 0.01, label: 'altura de los arcos' });
    this.p('escala', { min: 0.05, max: 0.4, default: 0.11, step: 0.005, label: 'separación por semitono' });
    this.p('velMin', { min: 0, max: 1, default: 0.3, step: 0.01, label: 'fuerza mínima de nota' });
    this.p('trazo', { min: 0.005, max: 0.08, default: 0.022, step: 0.001, label: 'grosor del trazo' });
    this.p('rosa', { min: 0, max: 3, default: 1, step: 0.01, label: 'rosa armónica' });
    this.p('espectro', { min: 0, max: 2, default: 0.8, step: 0.01, label: 'curva del espectro' });
    this.p('brillo', { min: 0, max: 3, default: 1, step: 0.01, label: 'brillo' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x05060c);
    s.fog = new THREE.FogExp2(0x05060c, 0.035);
    const lineMat = () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const mk = (n, name) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage)); g.setDrawRange(0, 0); const l = new THREE.LineSegments(g, lineMat()); l.name = name; l.frustumCulled = false; s.add(l); return l; };
    this.arcs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff }), 500 * SEG); this.arcs.name = 'arcos (notas)'; this.arcs.frustumCulled = false; this.arcs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.arcs.count = 0; s.add(this.arcs);
    this.staff = mk(4000, 'pentagrama');
    this.rose = mk(2 * 144, 'rosa armónica');
    this.spec = mk(2 * 200, 'espectro');
    // línea de lectura: plano tenue vertical en el ahora
    this.cursor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.cursor.name = 'línea de lectura'; s.add(this.cursor);
    this.floor = new WetFloor({ size: 70, repeat: 10, puddles: 0.3, reflect: 0.7, color: 0x8890a8 }); this.floor.position.y = -4.4; this.floor.userData.helper = true; s.add(this.floor);
    this.subject.radius = 4; this.subject.distance = 11;
    this.fixed = { pos: new THREE.Vector3(-0.2, 1.2, 9.5), look: new THREE.Vector3(-1.6, 0.2, -2), fov: 40 };
  }

  yOf(midi) { return (midi - 64) * this.v('escala'); }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), L = this.lookahead, now = c.t, bright = v('brillo'), k = this.v2('fourier.intensidad');
    const t0 = now - PAST * c.beatDur, t1 = now + L;
    const H = v('alturaNotas'), vmin = v('velMin');
    const X = 2.2;   // las notas van a la izquierda del eje; el pentagrama a lo largo de z

    // ---------- arcos ----------
    let ai = 0; const tr = v('trazo');
    if (this.v2('fourier.notas')) {
      for (const note of c.notesBetween(t0, t1)) {
        if (note.vel < vmin || ai + SEG > 500 * SEG) continue;
        const z0 = this.zOf(note.t0), z1 = this.zOf(Math.min(note.t1, t1)), y = this.yOf(note.midi);
        const active = note.t0 <= now && note.t1 > now, future = note.t0 > now;
        const flash = active ? 1 : Math.max(0, 1 - Math.abs(now - note.t0) / 0.3);
        _c.setHSL(this.hue((note.midi % 12) / 12), 0.85, 0.5 + flash * 0.3).multiplyScalar((future ? 0.3 : 0.75) * (0.6 + flash * 1.2 * k) * bright);
        const h = H * note.vel * 1.4, r = tr * (0.7 + note.vel) * (1 + flash * 0.8);
        for (let i = 0; i < SEG; i++) {
          const u0 = i / SEG, u1 = (i + 1) / SEG;
          const a = _v.set(-X, y + Math.sin(u0 * Math.PI) * h, z0 + (z1 - z0) * u0), b = _s.set(-X, y + Math.sin(u1 * Math.PI) * h, z0 + (z1 - z0) * u1);
          const dir = b.clone().sub(a), len = dir.length() || 0.001;
          _q.setFromUnitVectors(_up, dir.normalize());
          _m.compose(a.lerp(b, 0.5), _q, new THREE.Vector3(r, len * 1.05, r));
          this.arcs.setMatrixAt(ai, _m); this.arcs.setColorAt(ai, _c); ai++;
        }
      }
    }
    this.arcs.count = ai; this.arcs.instanceMatrix.needsUpdate = true; if (this.arcs.instanceColor) this.arcs.instanceColor.needsUpdate = true;
    let P, C, n;

    // ---------- pentagrama: líneas de octava, barras de beat, corchetes de sección ----------
    P = this.staff.geometry.attributes.position.array; C = this.staff.geometry.attributes.color.array; n = 0;
    const put = (x0, y0, z0, x1, y1, z1, col, a) => { if (n + 6 > P.length) return; P[n] = x0; P[n + 1] = y0; P[n + 2] = z0; P[n + 3] = x1; P[n + 4] = y1; P[n + 5] = z1; for (let j = 0; j < 2; j++) { C[n + j * 3] = col.r * a; C[n + j * 3 + 1] = col.g * a; C[n + j * 3 + 2] = col.b * a; } n += 6; };
    const zA = this.zOf(t0), zB = this.zOf(t1);
    for (let m = NOTE_LO; m <= NOTE_HI; m += 12) put(-X, this.yOf(m), zA, -X, this.yOf(m), zB, _c.set(0x8899bb), 0.5 * bright);
    for (const b of c.beatsBetween(t0, t1)) {
      const z = this.zOf(b.t), flash = Math.max(0, 1 - Math.abs(now - b.t) / 0.25);
      const sec = c.sectionAt(b.t), col = this.sectionColor(sec.type, 0.6);
      const h = b.downbeat ? 1 : 0.45;
      put(-X, this.yOf(NOTE_LO) - 0.3, z, -X, this.yOf(NOTE_LO) - 0.3 - h, z, col, (b.downbeat ? 0.8 : 0.35) * (1 + flash * 2 * k) * bright);
      if (b.downbeat) put(-X - 0.4, this.yOf(NOTE_HI) + 0.4, z, -X + 0.4, this.yOf(NOTE_HI) + 0.4, z, col, 0.5 * bright);
    }
    for (const s of c.sections) { if (s.t1 < t0 || s.t0 > t1) continue; const col = this.sectionColor(s.type, 0.55); put(-X, this.yOf(NOTE_HI) + 0.6, this.zOf(Math.max(s.t0, t0)), -X, this.yOf(NOTE_HI) + 0.6, this.zOf(Math.min(s.t1, t1)), col, 0.7 * bright); }
    this.staff.geometry.setDrawRange(0, n / 3); this.staff.geometry.attributes.position.needsUpdate = true; this.staff.geometry.attributes.color.needsUpdate = true;

    // ---------- rosa armónica (croma) en el ahora ----------
    P = this.rose.geometry.attributes.position.array; C = this.rose.geometry.attributes.color.array; n = 0;
    const rosa = v('rosa'), cx = X * 0.6, cy = 1.2;
    if (rosa > 0) {
      const N = 144, R = 2.2 * rosa;
      const rAt = (th) => { let r = 0.05; for (let q = 0; q < 12; q++) { const d = Math.cos(6 * th - (q * Math.PI) / 6); r += c.chroma[q] * d * d * d * d; } return r * R * (1 + this.flash * 0.3); };
      let maxq = 0; for (let q = 1; q < 12; q++) if (c.chroma[q] > c.chroma[maxq]) maxq = q;
      const col = _c.setHSL(this.hue(maxq / 12), 0.8, 0.6).multiplyScalar(bright * (0.6 + c.loud));
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, r0 = rAt(a0), r1 = rAt(a1);
        put(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, 0, cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, 0, col, 1);
      }
    }
    this.rose.geometry.setDrawRange(0, n / 3); this.rose.geometry.attributes.position.needsUpdate = true; this.rose.geometry.attributes.color.needsUpdate = true;

    // ---------- espectro del instante (saliencia por semitono) ----------
    P = this.spec.geometry.attributes.position.array; C = this.spec.geometry.attributes.color.array; n = 0;
    const A = this.app.music?.track?.analysis, esp = v('espectro');
    if (A && esp > 0) {
      const nP = NOTE_HI - NOTE_LO, f = Math.min(A.melody.length - 1, Math.max(0, Math.floor(now * A.noteFps)));
      for (let p = 0; p < nP - 1; p++) {
        const s0 = A.salience[f * nP + p], s1 = A.salience[f * nP + p + 1];
        const col = _c.setHSL(this.hue(((NOTE_LO + p) % 12) / 12), 0.7, 0.55);
        put(cx + (p / nP - 0.5) * 4.5, -2.6 + s0 * esp * 2.2, 0, cx + ((p + 1) / nP - 0.5) * 4.5, -2.6 + s1 * esp * 2.2, 0, col, (0.5 + s0) * 1.5 * bright);
      }
    }
    this.spec.geometry.setDrawRange(0, n / 3); this.spec.geometry.attributes.position.needsUpdate = true; this.spec.geometry.attributes.color.needsUpdate = true;

    this.cursor.position.set(-X, (this.yOf(NOTE_LO) + this.yOf(NOTE_HI)) / 2, 0);
    this.cursor.scale.set(0.02, this.yOf(NOTE_HI) - this.yOf(NOTE_LO) + 1.5, 1);
    this.cursor.rotation.y = Math.PI / 2;
    this.cursor.material.opacity = 0.06 + this.flash * 0.15;
    this.subject.center.set(-X * 0.4, 0.3, 0);
    this.finish(dt);
  }
}
