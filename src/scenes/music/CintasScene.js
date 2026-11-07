import * as THREE from 'three';
import { MusicScene, BAND_HUES } from './MusicScene.js';

/**
 * CINTAS: un vuelo por el tema a lo largo de un cable de luz por banda.
 *
 * Cinco cables (sub, grave, medio, agudo, aire) corren por el tiempo, en
 * abanico alrededor del eje. Cada cable respira con la envolvente de su
 * banda; cada golpe es una cuenta de luz que viaja hacia el público y
 * destella justo al pasar por el "ahora". Los beats son aros que cruzan
 * todos los cables (más grandes en el downbeat, del color de la sección).
 * Con la anticipación, las cuentas que vienen ya se ven acercarse.
 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0), _zax = new THREE.Vector3(0, 0, 1);
const PAST = 20;

export class CintasScene extends MusicScene {
  static id = 'cintas';
  static title = 'Cintas';
  constructor(app) { super(app, 'cintas', 'Cintas'); }

  defineParams() {
    super.defineParams();
    this.p('radio', { min: 0.5, max: 6, default: 2.2, step: 0.01, label: 'radio del abanico' });
    this.p('ondulacion', { min: 0, max: 3, default: 1, step: 0.01, label: 'ondulación de los cables' });
    this.p('grosor', { min: 0.01, max: 0.3, default: 0.06, step: 0.001, label: 'grosor de los cables' });
    this.p('cuentas', { min: 0, max: 3, default: 1, step: 0.01, label: 'tamaño de las cuentas' });
    this.p('aros', { min: 0, max: 2, default: 1, step: 0.01, label: 'aros de los beats' });
    this.p('brillo', { min: 0, max: 3, default: 1, step: 0.01, label: 'brillo' });
    this.p('niebla', { min: 0, max: 0.2, default: 0.05, step: 0.001, label: 'niebla' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x02030a);
    s.fog = new THREE.FogExp2(0x02030a, 0.05);
    const glow = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
    const add = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.cables = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), glow(), 5 * 64); this.cables.name = 'cables';
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), add(), 1200); this.beads.name = 'cuentas (golpes)';
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.03, 8, 48), add(), 128); this.rings.name = 'aros (beats)';
    this.halo = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 10), add(), 5); this.halo.name = 'destellos';
    for (const m of [this.cables, this.beads, this.rings, this.halo]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; s.add(m); }
    // polvo de fondo con paralaje
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = (Math.random() - 0.5) * 24; pos[i * 3 + 2] = -60 + Math.random() * 75; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x334466, size: 0.05, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); this.dust.name = 'polvo'; this.dust.userData.helper = true; s.add(this.dust);
    this.subject.radius = 3.5; this.subject.distance = 9;
    this.fixed = { pos: new THREE.Vector3(0, 1.1, 7.2), look: new THREE.Vector3(0, -0.6, -8), fov: 48 };
  }

  /** Centro de un cable en un instante (abanico + ondulación propia de cada banda). */
  cablePos(band, t, out) {
    const R = this.v('radio'), w = this.v('ondulacion');
    const a = -Math.PI / 2 + (band / 4) * Math.PI;         // abanico de 180° abajo del eje… girado para que el sub quede abajo
    const ang = a + Math.PI * 0.5;
    const wob = Math.sin(t * (0.35 + band * 0.07) + band * 1.7) * 0.5 * w;
    return out.set(Math.cos(ang) * R + wob, Math.sin(ang) * R * 0.6 - 0.6 + Math.cos(t * 0.27 + band) * 0.3 * w, this.zOf(t));
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), L = this.lookahead, now = c.t, bright = v('brillo'), k = this.v2('fourier.intensidad');
    const t0 = now - PAST * c.beatDur, t1 = now + L;
    this.scene.fog.density = v('niebla');
    const A = this.app.music?.track?.analysis;
    const envAt = (band, tt) => { if (!A) return c.bands[band].env; const f = Math.min(A.nFrames - 1, Math.max(0, Math.round(tt * A.fps))); return A.bands[band].env[f]; };

    // ---------- cables: un segmento por medio beat ----------
    let ci = 0; const step = c.beatDur * 0.5, thick = v('grosor');
    const first = Math.floor(t0 / step) * step;
    for (let band = 0; band < 5; band++) {
      const col = this.bandColor(band, 0.5);
      const pulse = c.bands[band].pulse;
      for (let tt = first; tt < t1 && ci < 5 * 64; tt += step) {
        const a = this.cablePos(band, tt, _v).clone(), b = this.cablePos(band, tt + step, _s).clone();
        const dir = b.clone().sub(a), len = dir.length();
        const e = envAt(band, tt), future = tt > now;
        const r = thick * (0.5 + 1.2 * e) * (future ? 0.6 : 1);
        _q.setFromUnitVectors(_up, dir.normalize());
        _m.compose(a.lerp(b, 0.5), _q, _s.set(r, len * 1.02, r));
        this.cables.setMatrixAt(ci, _m);
        const near = Math.max(0, 1 - Math.abs(tt - now) / (c.beatDur * 2));
        this.cables.setColorAt(ci, _c.copy(col).multiplyScalar((0.25 + 0.9 * e + near * pulse * 0.8) * (future ? 0.5 : 1) * bright)); ci++;
      }
    }
    this.cables.count = ci;

    // ---------- cuentas: un golpe por banda ----------
    let bi = 0; const thr = this.threshold, bead = v('cuentas');
    for (let band = 0; band < 5; band++) {
      const hue = this.hue(BAND_HUES[band]);
      for (const o of c.onsetsBetween(band, t0, t1)) {
        if (o.s < thr || bi >= 1200) continue;
        const p = this.cablePos(band, o.t, _v);
        const future = o.t > now, flash = Math.max(0, 1 - Math.abs(now - o.t) / 0.22);
        const approach = future ? Math.max(0, 1 - (o.t - now) / L) : 1;
        const size = (0.05 + 0.16 * o.s) * bead * (future ? 0.4 + 0.6 * approach : 1) * (1 + flash * 1.8 * k);
        _m.compose(p, _q.identity(), _s.set(size, size, size));
        this.beads.setMatrixAt(bi, _m);
        this.beads.setColorAt(bi, _c.setHSL(hue, 0.85, 0.55 + flash * 0.4).multiplyScalar((future ? 0.3 + 0.6 * approach : 0.8) * (0.7 + flash * 2 * k) * bright)); bi++;
      }
    }
    this.beads.count = bi;

    // ---------- aros en cada beat ----------
    let ri = 0; const aros = v('aros');
    if (aros > 0) for (const b of c.beatsBetween(t0, t1)) {
      if (ri >= 128) break;
      const sec = c.sectionAt(b.t), col = this.sectionColor(sec.type, 0.6);
      const flash = Math.max(0, 1 - Math.abs(now - b.t) / 0.3), future = b.t > now;
      const R = v('radio') * (b.downbeat ? 1.25 : 1.0) * (1 + flash * 0.15 * k) * aros;
      _m.compose(_v.set(0, -0.6, this.zOf(b.t)), _q.identity(), _s.set(R, R * 0.7, R));
      this.rings.setMatrixAt(ri, _m);
      this.rings.setColorAt(ri, _c.copy(col).multiplyScalar((b.downbeat ? 0.6 : 0.25) * (future ? 0.5 : 1) * (1 + flash * 2.5 * k) * bright)); ri++;
    }
    this.rings.count = ri;

    // ---------- destello en el "ahora" de cada cable ----------
    for (let band = 0; band < 5; band++) {
      const p = this.cablePos(band, now, _v), pz = c.bands[band].pulse;
      const size = 0.08 + 0.45 * pz * k;
      _m.compose(p, _q.identity(), _s.set(size, size, size));
      this.halo.setMatrixAt(band, _m); this.halo.setColorAt(band, this.bandColor(band, 0.7).multiplyScalar(pz * 1.5 * bright));
    }
    this.halo.count = 5;
    for (const m of [this.cables, this.beads, this.rings, this.halo]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.dust.rotation.z += dt * 0.02;

    this.subject.center.set(0, -0.6, 0);
    this.finish(dt);
  }
}
