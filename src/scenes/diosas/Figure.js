import * as THREE from 'three';
import { EYE, LID, NECK_PIVOT, upperLidPhi, lowerLidPhi } from './anatomy.js';
import { skinMaterial, eyeMaterial, hairMaterial, lashMaterial, figureUniforms } from './materials.js';
import { buildHeaddress, buildEarring, buildChoker, buildGarmentGems } from './ornaments.js';
import { haloMaterial } from './cosmos.js';
import { emptyPose } from './motions.js';
import { ModelInstance } from './model.js';

/**
 * Una diosa: busto + cabeza (sobre un pivote en el cuello) + ojos con
 * párpados móviles, pestañas y delineado + pelo + joyas + halo.
 *
 * Jerarquía (los nombres aparecen en el editor):
 *   diosa N
 *   ├─ busto, gargantilla, pedrería, halo
 *   └─ cuello (pivote) → cabeza
 *        ├─ rostro, pelo, tocado, aro izq / der
 *        └─ ojo izq / der → globo, párpado (pestañas, delineado), pestañas inferiores
 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _e = new THREE.Euler();
const dirOf = (th, ph, r = 1, out = new THREE.Vector3()) => out.set(Math.sin(th) * Math.cos(ph) * r, Math.sin(ph) * r, Math.cos(th) * Math.cos(ph) * r);
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- geometrías del ojo (para el ojo +x; el otro se refleja con scale.x = -1) ----------
function lidShellGeometry() {
  const R = EYE.r * 1.055, NT = 28, NP = 10;
  const t0 = LID.inner - 0.18, t1 = LID.outer + 0.18;
  const pos = [], nrm = [], ao = [], masks = [], idx = [];
  for (let j = 0; j <= NP; j++) for (let i = 0; i <= NT; i++) {
    const th = t0 + (t1 - t0) * (i / NT);
    const ph = upperLidPhi(th) + (j / NP) * 1.15;
    const d = dirOf(th, ph);
    pos.push(d.x * R, d.y * R, d.z * R); nrm.push(d.x, d.y, d.z);
    ao.push(0.85 + 0.15 * (j / NP)); masks.push(0, 0.95 - 0.6 * (j / NP), 0, 0);
  }
  for (let j = 0; j < NP; j++) for (let i = 0; i < NT; i++) {
    const a = j * (NT + 1) + i, b = a + 1, c = a + NT + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('masks', new THREE.Float32BufferAttribute(masks, 4));
  g.setIndex(idx);
  return g;
}

/** Cinta fina sobre el borde del párpado (delineado), más gruesa hacia afuera. */
function linerGeometry() {
  const R = EYE.r * 1.115, N = 40, pos = [], nrm = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const th = LID.inner + 0.06 + (LID.outer - LID.inner - 0.04) * (i / N);
    const ph = upperLidPhi(th);
    const w = (0.008 + 0.024 * THREE.MathUtils.smoothstep(th, -0.3, LID.outer)) / R;
    for (const dp of [-0.004 / R, w]) { const d = dirOf(th, ph + dp); pos.push(d.x * R, d.y * R, d.z * R); nrm.push(d.x, d.y, d.z); }
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx);
  return g;
}

/** Pestañas como cintas curvas. upper: arriba (largas, hacia afuera = ojo de gato) o abajo. */
function lashGeometry(upper, seed) {
  const rnd = rng(seed);
  const R = EYE.r * 1.11, n = upper ? 78 : 30, segs = 4;
  const pos = [], nrm = [], idx = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    const k = (i + rnd() * 0.6) / n;
    const th = upper ? LID.inner + 0.2 + (LID.outer - 0.02 - LID.inner - 0.2) * Math.pow(k, 0.85) : LID.inner + 0.45 + (LID.outer - 0.08 - LID.inner - 0.45) * k;
    const ph = upper ? upperLidPhi(th) + 0.012 : lowerLidPhi(th) - 0.01;
    const root = dirOf(th, ph, R);
    const nOut = dirOf(th, ph);
    const up = new THREE.Vector3(-Math.sin(th) * Math.sin(ph), Math.cos(ph), -Math.cos(th) * Math.sin(ph)).normalize();
    const lat = new THREE.Vector3(Math.cos(th), 0, -Math.sin(th));
    const outer = THREE.MathUtils.smoothstep(th, -0.4, LID.outer);
    const L = upper ? (0.05 + 0.1 * outer) * (0.75 + 0.5 * rnd()) : (0.02 + 0.025 * outer) * (0.7 + 0.6 * rnd());
    const dir = nOut.clone().multiplyScalar(0.75).addScaledVector(up, upper ? 0.3 : -0.55).addScaledVector(lat, (upper ? 0.35 : 0.25) * outer).normalize();
    let p = root.clone();
    for (let s = 0; s <= segs; s++) {
      const w = (upper ? 0.0055 : 0.0032) * (1 - 0.8 * (s / segs));
      pos.push(p.x - lat.x * w, p.y - lat.y * w, p.z - lat.z * w, p.x + lat.x * w, p.y + lat.y * w, p.z + lat.z * w);
      nrm.push(nOut.x, nOut.y, nOut.z, nOut.x, nOut.y, nOut.z);
      if (s < segs) { idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
      v += 2;
      dir.addScaledVector(up, upper ? 0.4 : -0.15).normalize();
      p = p.clone().addScaledVector(dir, L / segs);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx);
  return g;
}

let EYE_GEO = null;
function eyeGeometries() {
  if (!EYE_GEO) EYE_GEO = { ball: new THREE.SphereGeometry(EYE.r, 48, 32), lid: lidShellGeometry(), liner: linerGeometry(), lashU: lashGeometry(true, 3), lashL: lashGeometry(false, 9) };
  return EYE_GEO;
}

export function geometryFromArrays(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  if (a.ao) g.setAttribute('ao', new THREE.BufferAttribute(a.ao, 1));
  if (a.masks) g.setAttribute('masks', new THREE.BufferAttribute(a.masks, 4));
  if (a.tangent) g.setAttribute('aTan', new THREE.BufferAttribute(a.tangent, 3));
  if (a.uv) g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  if (a.strand) g.setAttribute('strand', new THREE.BufferAttribute(a.strand, 2));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  return g;
}

export class Figure {
  /**
   * def: { pos, rotY, tocado, pelo, seed }   ctx: { U, mats, assets(kind,args) → Promise }
   */
  constructor(index, def, ctx) {
    this.index = index; this.def = def; this.ctx = ctx;
    this.F = figureUniforms();
    this.F.uFade.value = 0;
    this.F.uPivot.value.set(NECK_PIVOT.x, NECK_PIVOT.y, NECK_PIVOT.z);
    this.rnd = rng(def.seed * 101);
    this.ready = false;
    this.visible = true;
    this.appear = 0;

    const root = this.root = new THREE.Group();
    root.name = `diosa ${index + 1}`;
    root.position.fromArray(def.pos); root.rotation.y = def.rotY;
    this.neck = new THREE.Group(); this.neck.name = 'cuello';
    this.neck.position.set(NECK_PIVOT.x, NECK_PIVOT.y, NECK_PIVOT.z);
    this.neck.rotation.order = 'YXZ';
    this.head = new THREE.Group(); this.head.name = 'cabeza';
    this.head.position.set(-NECK_PIVOT.x, -NECK_PIVOT.y, -NECK_PIVOT.z);
    this.neck.add(this.head);
    root.add(this.neck);

    this.skinHead = skinMaterial(ctx.U, this.F, 'head');
    this.skinBody = skinMaterial(ctx.U, this.F, 'body');
    this.skinLid = skinMaterial(ctx.U, this.F, 'lid');
    this.hairMat = hairMaterial(ctx.U, this.F);
    this.lashMat = lashMaterial(ctx.U, this.F);

    // ojos
    const G = eyeGeometries();
    this.eyes = [1, -1].map((side) => {
      const rig = new THREE.Group(); rig.name = side > 0 ? 'ojo izq' : 'ojo der';
      rig.position.set(side * EYE.x, EYE.y, EYE.z); rig.scale.x = side;
      const mat = eyeMaterial(ctx.U, this.F, def.seed * 3.1 + side);
      const ball = new THREE.Mesh(G.ball, mat); ball.name = 'globo'; ball.rotation.order = 'YXZ';
      const lid = new THREE.Group(); lid.name = 'párpado';
      const shell = new THREE.Mesh(G.lid, this.skinLid); shell.name = 'piel del párpado';
      const liner = new THREE.Mesh(G.liner, this.lashMat); liner.name = 'delineado';
      const lashU = new THREE.Mesh(G.lashU, this.lashMat); lashU.name = 'pestañas';
      lid.add(shell, liner, lashU);
      const lashL = new THREE.Mesh(G.lashL, this.lashMat); lashL.name = 'pestañas inferiores';
      rig.add(ball, lid, lashL);
      this.head.add(rig);
      return { side, rig, ball, lid, mat, yaw: 0, pitch: 0 };
    });

    // halo detrás de la cabeza
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), haloMaterial(ctx.U, this.F));
    this.halo.name = 'halo'; this.halo.position.set(0, 0.25, -1.0); this.halo.renderOrder = -1; this.halo.userData.helper = true;
    root.add(this.halo);

    // estado
    this.pose = emptyPose();
    this.gaze = { target: new THREE.Vector3(0, 0, 10), drift: new THREE.Vector3(), driftT: 0, micro: new THREE.Vector2(), microT: 0, lastYaw: 0 };
    this.headLook = new THREE.Vector2();
    this.blink = { t: 1, next: 1 + this.rnd() * 3, dur: 0.28 };
    this.lidAngle = 0.1;
    this.ear = [{ ax: 0, az: 0, vx: 0, vz: 0 }, { ax: 0, az: 0, vx: 0, vz: 0 }];
    this.prevRot = new THREE.Euler();
    this.load();
  }

  async load() {
    const { assets, mats, quality } = this.ctx;
    const [head, body, hair] = await Promise.all([
      assets('head', { quality }), assets('body', { quality }), assets('hair', { quality, style: this.def.pelo, seed: 1 }),
    ]);
    if (this.disposed) return;
    this.face = new THREE.Mesh(head.geometry, this.skinHead); this.face.name = 'rostro';
    this.body = new THREE.Mesh(body.geometry, this.skinBody); this.body.name = 'busto';
    this.hair = new THREE.Mesh(hair.geometry, this.hairMat); this.hair.name = 'pelo'; this.hair.frustumCulled = false;
    this.head.add(this.face, this.hair);
    this.root.add(this.body);
    this.choker = buildChoker(mats); this.root.add(this.choker);
    this.gems = buildGarmentGems(body.arrays, mats, 130, this.def.seed); this.root.add(this.gems);
    this.earrings = [buildEarring(1, mats), buildEarring(-1, mats)];
    this.head.add(...this.earrings);
    this.setHeaddress(this.def.tocado);
    this.ready = true;
  }

  setHeaddress(type) {
    if (this.headdress) { this.head.remove(this.headdress); this.headdress.traverse((o) => o.geometry?.dispose()); }
    this.headdress = buildHeaddress(type, this.ctx.mats, this.def.seed);
    this.head.add(this.headdress);
  }

  /** Cambia el estilo de pelo (pide la malla al worker). */
  async setHair(style) {
    if (style === this.def.pelo && this.hair) return;
    this.def.pelo = style;
    const hair = await this.ctx.assets('hair', { quality: this.ctx.quality, style, seed: 1 });
    if (this.hair) this.hair.geometry = hair.geometry;
  }

  /** Usa un modelo GLB (plantilla de model.js) en lugar de la anatomía procedural; null vuelve a la procedural. */
  setModel(template) {
    if (this.model) { this.root.remove(this.model.root); this.model.root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); this.model = null; }
    if (template?.rig.ok) { this.model = new ModelInstance(template, this.ctx.U, this.F); this.root.add(this.model.root); }
  }

  /** Muestra u oculta las partes procedurales según haya modelo (las joyas pueden quedar). */
  applyVisibility(keepJewels) {
    const proc = !this.model;
    for (const o of [this.face, this.body, this.hair, this.gems, ...this.eyes.map((e) => e.rig)]) if (o) o.visible = proc;
    for (const o of [this.choker, this.headdress, ...(this.earrings || [])]) if (o) o.visible = proc || keepJewels;
  }

  headWorld(out = new THREE.Vector3()) { return this.head.localToWorld(out.set(0, 0.1, 0.4)); }
  eyesWorld(out = new THREE.Vector3()) { return this.head.localToWorld(out.set(0, EYE.y, EYE.z)); }

  /**
   * s: estado de la escena para este frame (parámetros ya leídos + pose
   * mezclada + objetivo de la mirada en coordenadas de mundo).
   */
  update(dt, t, s, pose, target) {
    // aparición / desaparición
    const want = this.visible && this.ready ? 1 : 0;
    this.appear += (want - this.appear) * (1 - Math.exp(-dt * (want ? 1.2 : 3)));
    this.F.uFade.value = this.appear * (this.def.dim ?? 1);
    this.root.visible = this.appear > 0.003;
    if (!this.root.visible) return;
    const grow = THREE.MathUtils.smoothstep(this.appear, 0.2, 1);
    if (this.headdress) this.headdress.scale.setScalar(Math.max(0.001, grow));
    if (this.choker) this.choker.scale.setScalar(Math.max(0.001, grow));

    // ---------- mirada ----------
    const g = this.gaze;
    // deriva: puntos al azar cerca del frente, con pausas
    g.driftT -= dt;
    if (g.driftT <= 0) {
      g.driftT = 0.7 + this.rnd() * 2.6;
      g.drift.set((this.rnd() - 0.5) * 7, (this.rnd() - 0.55) * 3.5, 6);
    }
    // microsacadas
    g.microT -= dt;
    if (g.microT <= 0) { g.microT = 0.25 + this.rnd() * 0.9; g.micro.set((this.rnd() - 0.5), (this.rnd() - 0.5)).multiplyScalar(0.06 * s.micro); }

    const drift = _v2.copy(g.drift);
    this.root.localToWorld(drift);
    const goal = _v.copy(drift).lerp(target, s.presence);
    g.target.lerp(goal, 1 - Math.exp(-dt * 6 * s.gazeSpeed));

    // la cabeza acompaña la mirada (más lento que los ojos)
    const local = this.root.worldToLocal(_v.copy(g.target)).sub(_v2.set(0, 0.1, 0.4));
    const tYaw = Math.atan2(local.x, Math.max(0.3, local.z)), tPitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
    this.headLook.x += (THREE.MathUtils.clamp(tYaw, -0.8, 0.8) * s.headFollow - this.headLook.x) * (1 - Math.exp(-dt * 2.2 * s.gazeSpeed));
    this.headLook.y += (THREE.MathUtils.clamp(tPitch, -0.4, 0.4) * s.headFollow - this.headLook.y) * (1 - Math.exp(-dt * 2.2 * s.gazeSpeed));

    // ---------- pose de la cabeza ----------
    const A = s.amount;
    this.neck.rotation.set(
      -(pose.pitch * A + this.headLook.y),
      pose.yaw * A + this.headLook.x,
      -pose.roll * A,
    );
    const shift = _v2.set(pose.slide * A, pose.rise * A + Math.sin(t * 1.1 + this.def.seed) * 0.012, pose.lean * A);
    this.neck.position.set(NECK_PIVOT.x, NECK_PIVOT.y, NECK_PIVOT.z).add(shift);
    this.neck.updateMatrix();
    _m.makeRotationFromEuler(this.neck.rotation).invert();
    this.F.uNeckInv.value.setFromMatrix4(_m);
    this.F.uShift.value.copy(shift);
    this.root.updateMatrixWorld(true);

    // ---------- ojos ----------
    const up = s.gazeUp + pose.gazeUp;
    let bigJump = false;
    for (const e of this.eyes) {
      const p = e.rig.worldToLocal(_v.copy(g.target));
      let yaw = Math.atan2(p.x, Math.max(0.05, p.z));
      let pitch = Math.atan2(p.y, Math.hypot(p.x, p.z));
      pitch = pitch * (1 - Math.min(1, up)) + 0.62 * Math.min(1, up);
      yaw += g.micro.x * e.side; pitch += g.micro.y;
      yaw = THREE.MathUtils.clamp(yaw, -0.5, 0.72);
      pitch = THREE.MathUtils.clamp(pitch, -0.42, 0.66);
      if (Math.abs(yaw - e.yaw) > 0.3) bigJump = true;
      const k = 1 - Math.exp(-dt * 28 * s.gazeSpeed);
      e.yaw += (yaw - e.yaw) * k; e.pitch += (pitch - e.pitch) * k;
      e.ball.rotation.set(-e.pitch, e.yaw, 0);
    }

    // ---------- modelo GLB: misma pose y misma mirada sobre sus huesos ----------
    if (this.model) {
      const M = this.model;
      if (M.fitKey !== s.modelFitKey) { M.fit(s.modelScale, s.modelY, s.modelZ); M.fitKey = s.modelFitKey; }
      M.root.position.copy(M.basePos).addScaledVector(shift, 0.6);
      M.E.uNeon.value = s.modelNeon;
      M.update(this.root, this.neck.rotation, g.target, { arms: s.modelArms, eyeAmount: s.modelEyes, gazeUp: up, sway: s.sway, time: t });
    }
    this.applyVisibility(s.modelJewels);

    // ---------- parpadeo ----------
    const b = this.blink;
    b.next -= dt;
    if (s.blinkRate > 0 && b.next > 120 / s.blinkRate) b.next = this.rnd() * (60 / s.blinkRate);
    if ((b.next <= 0 && s.blinkRate > 0) || (bigJump && b.t >= 1 && this.rnd() < 0.4) || s.blinkNow) {
      b.t = 0; b.dur = 0.22 + this.rnd() * 0.12;
      b.next = s.blinkRate > 0 ? (60 / s.blinkRate) * (0.4 + this.rnd() * 1.2) : 1e9;
    }
    b.t = Math.min(1, b.t + dt / b.dur);
    const closeK = b.t < 0.35 ? THREE.MathUtils.smoothstep(b.t, 0, 0.35) : 1 - THREE.MathUtils.smoothstep(b.t, 0.45, 1);
    const open = THREE.MathUtils.clamp(s.openness * pose.lids, 0, 1.15);
    const eyePitch = (this.eyes[0].pitch + this.eyes[1].pitch) / 2;
    let aOpen = (1 - open) * (LID.up + LID.low) * 0.75 + Math.max(0, -eyePitch) * 0.55 - Math.max(0, eyePitch) * 0.12;
    aOpen = Math.max(-0.05, aOpen);
    const aClosed = LID.up + LID.low + 0.1;
    const target01 = aOpen + (aClosed - aOpen) * closeK;
    this.lidAngle += (target01 - this.lidAngle) * (1 - Math.exp(-dt * 30));
    for (const e of this.eyes) e.lid.rotation.x = this.lidAngle;

    // ---------- boca ----------
    this.F.uMouth.value = THREE.MathUtils.clamp(s.mouth + pose.mouth * 0.6, 0, 1);

    // ---------- aros: péndulo que reacciona al giro de la cabeza ----------
    if (this.earrings) {
      const r = this.neck.rotation, pr = this.prevRot;
      const wx = (r.x - pr.x) / Math.max(dt, 1e-3), wz = (r.z - pr.z) / Math.max(dt, 1e-3), wy = (r.y - pr.y) / Math.max(dt, 1e-3);
      this.earrings.forEach((ear, i) => {
        const st = this.ear[i];
        const tx = -r.x, tz = -r.z;
        st.vx += ((tx - st.ax) * 40 - st.vx * 3.2 - wx * 8 + wy * 3 * (i ? -1 : 1)) * dt;
        st.vz += ((tz - st.az) * 40 - st.vz * 3.2 - wz * 8 + wy * 2) * dt;
        st.ax += st.vx * dt; st.az += st.vz * dt;
        ear.rotation.set(st.ax, 0, st.az);
      });
      pr.copy(r);
    }

    // halo de frente a la cámara
    this.halo.lookAt(s.camera.position);
  }

  setEyeColors(c1, c2, sclera, s, hetero) {
    this.eyes.forEach((e, i) => {
      const u = e.mat.uniforms;
      const h = hetero * (i ? 1 : 0);
      u.uIris1.value.copy(c1).offsetHSL(h, 0, 0);
      u.uIris2.value.copy(c2).offsetHSL(h, 0, 0);
      u.uSclera.value.copy(sclera);
      u.uIrisSize.value = s.iris; u.uPupil.value = s.pupil; u.uEyeGlow.value = s.eyeGlow;
    });
    if (this.model) { this.model.E.uIris.value.copy(c1); this.model.E.uEyeGlow.value = s.eyeGlow; }
  }

  dispose() {
    this.disposed = true;
    this.root.traverse((o) => { if (o.material && !o.material.isMeshStandardMaterial) o.material.dispose?.(); });
  }
}
