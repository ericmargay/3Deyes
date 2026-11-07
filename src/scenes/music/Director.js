import * as THREE from 'three';

/**
 * Director de cámara (como el modo FLUID de visualinst): cambia de plano en
 * el primer beat del compás, cada 1, 2 o 4 compases según la energía; en un
 * cambio de sección elige un plano dramático; entre cortes la cámara respira
 * y hace un punch-in en los kicks fuertes. Algunos cambios deslizan en uno o
 * dos segundos, otros cortan en seco justo en el downbeat.
 *
 * Planos: lateral, holandés, macro, amplio, giro, curva, pasarela, persecución,
 * inclinado, órbita, picado. Se calculan sobre el `subject` de la escena
 * (centro, eje del tiempo hacia el espectador, radio).
 *
 * Parámetros (grupo `director`): activo, caos (deriva, roll y frecuencia de
 * cortes), profundidad 3D (cuánto se inclinan los planos), cortes secos
 * (proporción), compases (auto / 1 / 2 / 4 / 8).
 */
export const SHOTS = ['lateral', 'holandés', 'macro', 'amplio', 'giro', 'curva', 'pasarela', 'persecución', 'inclinado', 'órbita', 'picado'];
const DRAMATIC = ['amplio', 'picado', 'pasarela', 'giro'];
const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _r = new THREE.Vector3(), _u = new THREE.Vector3();

export class Director {
  constructor(scene) {
    this.scene = scene; this.params = scene.params;
    this.shot = 'amplio'; this.prevShot = null; this.k = 1; this.glide = 1.5; this.hard = false;
    this.pose = { pos: new THREE.Vector3(0, 0, 10), look: new THREE.Vector3(), roll: 0, fov: 45 };
    this.from = { pos: new THREE.Vector3(0, 0, 10), look: new THREE.Vector3(), roll: 0, fov: 45 };
    this.to = { pos: new THREE.Vector3(0, 0, 10), look: new THREE.Vector3(), roll: 0, fov: 45 };
    this.seed = Math.random() * 100; this.punch = 0; this.sinceCut = 0; this.barsSinceCut = 0; this.spin = 0;
    this.shotParam = Math.random();
  }

  defineParams() {
    const p = this.params, d = (id, o) => { if (!p.has(id)) p.define(id, o); };
    d('director.activo', { default: false, label: 'director de cámara (V)' });
    d('director.caos', { min: 0, max: 1, default: 0.4, step: 0.01, label: 'caos' });
    d('director.profundidad', { min: 0, max: 1, default: 0.6, step: 0.01, label: 'profundidad 3D' });
    d('director.cortes', { min: 0, max: 1, default: 0.5, step: 0.01, label: 'cortes secos (proporción)' });
    d('director.compases', { type: 'option', options: ['auto', '1', '2', '4', '8'], default: 'auto', label: 'cambiar cada N compases' });
    d('director.plano', { type: 'option', options: SHOTS, default: 'amplio', label: 'plano (manual)' });
    d('director.siguiente', { type: 'trigger', label: 'siguiente plano' });
    d('director.fov', { min: 15, max: 110, default: 45, step: 0.5, label: 'fov base' });
    d('director.respirar', { min: 0, max: 2, default: 1, step: 0.01, label: 'respiración de la cámara' });
    if (!this._bound) {
      this._bound = true;
      p.onChange((id, v) => {
        if (id === 'director.plano' && !p.get('director.activo')) this.cut(v, true, 1.2);
        if (id === 'director.siguiente') this.cut(SHOTS[(SHOTS.indexOf(this.shot) + 1) % SHOTS.length], Math.random() < p.get('director.cortes'));
      });
    }
  }

  /** Pose de un plano sobre el sujeto. k = parámetro aleatorio del plano, e = energía 0..1, t = tiempo. */
  computeShot(name, S, k, e, t, out) {
    const depth = this.params.get('director.profundidad'), D = S.distance, R = S.radius;
    const f = S.forward, u = S.up, r = _r.crossVectors(u, f).normalize();   // derecha
    const C = S.center;
    let pos, look, roll = 0, fov = this.params.get('director.fov');
    const side = k < 0.5 ? -1 : 1;
    switch (name) {
      case 'lateral': pos = _p.copy(C).addScaledVector(r, side * D * 0.95).addScaledVector(f, D * 0.1).addScaledVector(u, R * 0.25); look = _l.copy(C).addScaledVector(f, -R * 0.5); break;
      case 'holandés': pos = _p.copy(C).addScaledVector(f, D * 0.8).addScaledVector(r, side * D * 0.5).addScaledVector(u, R * 0.3); look = _l.copy(C).addScaledVector(f, -R); roll = side * (0.18 + 0.25 * k); fov *= 0.9; break;
      case 'macro': pos = _p.copy(C).addScaledVector(f, D * 0.4).addScaledVector(r, (k - 0.5) * D * 0.5).addScaledVector(u, R * 0.35); look = _l.copy(C).addScaledVector(f, -R * 0.3); fov *= 1.15; break;
      case 'amplio': pos = _p.copy(C).addScaledVector(f, D * 0.85).addScaledVector(u, D * (0.25 + 0.3 * depth)).addScaledVector(r, side * D * 0.45); look = _l.copy(C).addScaledVector(f, -R * 0.8); fov *= 1.05; break;
      case 'giro': { const a = this.spin; pos = _p.copy(C).addScaledVector(r, Math.sin(a) * D * 0.8).addScaledVector(f, Math.cos(a) * D * 0.8).addScaledVector(u, R * 0.3 * depth); look = _l.copy(C); break; }
      case 'curva': { const a = (k - 0.5) * 1.6 * depth; pos = _p.copy(C).addScaledVector(r, Math.sin(a) * D).addScaledVector(f, Math.cos(a) * D).addScaledVector(u, R * 0.2); look = _l.copy(C).addScaledVector(f, -R * 0.5); break; }
      case 'pasarela': pos = _p.copy(C).addScaledVector(f, D * 0.7).addScaledVector(u, -R * 0.25 * depth); look = _l.copy(C).addScaledVector(f, -R * 2); fov *= 1.2; break;
      case 'persecución': pos = _p.copy(C).addScaledVector(f, -R * 0.2).addScaledVector(u, R * 0.6 * depth).addScaledVector(r, side * R * 0.3); look = _l.copy(C).addScaledVector(f, R * 3); fov *= 1.1; break;
      case 'inclinado': pos = _p.copy(C).addScaledVector(f, D * 0.95).addScaledVector(u, R * (0.9 + 0.6 * k) * depth); look = _l.copy(C); break;
      case 'órbita': { const a = this.spin * 0.6 + k * 6.28; pos = _p.copy(C).addScaledVector(r, Math.sin(a) * D * 0.9).addScaledVector(f, Math.cos(a) * D * 0.9).addScaledVector(u, R * 0.5 * depth); look = _l.copy(C); break; }
      case 'picado': pos = _p.copy(C).addScaledVector(u, D * (0.6 + 0.5 * depth)).addScaledVector(f, D * 0.5); look = _l.copy(C).addScaledVector(f, -R * 0.5); fov *= 1.1; break;
      default: pos = _p.copy(C).addScaledVector(f, D); look = _l.copy(C);
    }
    out.pos.copy(pos); out.look.copy(look); out.roll = roll; out.fov = fov;
    return out;
  }

  /** Punch-in en los kicks fuertes (también con la cámara fija). */
  punchIn(dt, c) { if (c.bands[0].hit > 0.55) this.punch = Math.max(this.punch, c.bands[0].hit); this.punch *= Math.exp(-dt * 7); return this.punch * this.params.get('director.respirar'); }

  cut(name, hard, glide = 1.5) {
    this.prevShot = this.shot; this.shot = name; this.shotParam = Math.random();
    this.from.pos.copy(this.pose.pos); this.from.look.copy(this.pose.look); this.from.roll = this.pose.roll; this.from.fov = this.pose.fov;
    this.k = hard ? 1 : 0; this.glide = glide; this.hard = hard; this.sinceCut = 0; this.barsSinceCut = 0;
  }

  update(dt, c, S, camera) {
    const p = this.params, active = p.get('director.activo'), chaos = p.get('director.caos'), e = c.energy ?? 0.5;
    this.sinceCut += dt;
    this.spin += dt * (0.25 + chaos * 0.5);
    if (active) {
      if (c.onDownbeat) this.barsSinceCut++;
      const every = p.get('director.compases');
      const n = every === 'auto' ? (e > 0.7 ? 1 : e > 0.4 ? 2 : 4) : Number(every);
      const chance = every === 'auto' ? 0.55 + chaos * 0.45 : 1;
      if (c.onSection) { this.cut(DRAMATIC[Math.floor(Math.random() * DRAMATIC.length)], true, 0); if (p.get('fx.auto') && this.scene.app.stereo?.fx) this.scene.app.stereo.fx.randomize(e); }
      else if (c.onDownbeat && this.barsSinceCut >= n && Math.random() < chance) {
        let next; do { next = SHOTS[Math.floor(Math.random() * SHOTS.length)]; } while (next === this.shot);
        this.cut(next, Math.random() < p.get('director.cortes'), 0.8 + 1.4 * (1 - chaos));
      }
      if (c.bands[0].hit > 0.55) this.punch = Math.max(this.punch, c.bands[0].hit);
    }
    this.punch *= Math.exp(-dt * 7);
    // destino del plano actual
    this.computeShot(active ? this.shot : p.get('director.plano'), S, this.shotParam, e, c.t, this.to);
    // transición
    this.k = Math.min(1, this.k + (this.glide > 0 ? dt / this.glide : 1));
    const s = this.k * this.k * (3 - 2 * this.k);
    const P = this.pose;
    P.pos.lerpVectors(this.from.pos, this.to.pos, s); P.look.lerpVectors(this.from.look, this.to.look, s);
    P.roll = this.from.roll + (this.to.roll - this.from.roll) * s; P.fov = this.from.fov + (this.to.fov - this.from.fov) * s;
    // respiración + punch-in
    const br = p.get('director.respirar') * (0.5 + chaos), t = c.t + this.seed;
    _u.set(Math.sin(t * 0.7) * 0.12, Math.sin(t * 0.53 + 1) * 0.08, Math.sin(t * 0.41 + 2) * 0.1).multiplyScalar(br * S.radius * 0.12);
    const toLook = _l.subVectors(P.look, P.pos); const dist = toLook.length(); toLook.normalize();
    camera.position.copy(P.pos).add(_u).addScaledVector(toLook, this.punch * S.radius * 0.18);
    camera.up.copy(S.up);
    camera.lookAt(_p.copy(P.look).addScaledVector(_u, 0.5));
    camera.rotateZ(P.roll + Math.sin(t * 0.3) * 0.02 * br * chaos);
    camera.fov = P.fov * (1 - this.punch * 0.06);
    camera.updateProjectionMatrix();
    void dist;
  }
}
