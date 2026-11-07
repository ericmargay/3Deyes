import * as THREE from 'three';
import { headSDF } from './anatomy.js';

/**
 * Joyería y tocados. Las piezas se apoyan sobre la cabeza buscando la
 * superficie de la SDF (más el volumen del pelo), así calzan aunque se
 * cambie la anatomía.
 *
 * Tocados:
 *   luna     diadema con lágrima y luna creciente en la frente, alas de gemas
 *   sol      corona de rayos dorados detrás de la cabeza (halo solar)
 *   espinas  corona de púas con gemas en las puntas
 */
export const HEADDRESSES = ['luna', 'sol', 'espinas', 'ninguno'];

const CENTER = new THREE.Vector3(0, 0.3, -0.12);
const _v = new THREE.Vector3();

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function headNormal(p, out = new THREE.Vector3()) {
  const e = 0.004;
  out.set(
    headSDF(p.x + e, p.y, p.z) - headSDF(p.x - e, p.y, p.z),
    headSDF(p.x, p.y + e, p.z) - headSDF(p.x, p.y - e, p.z),
    headSDF(p.x, p.y, p.z + e) - headSDF(p.x, p.y, p.z - e),
  );
  return out.normalize();
}

/** Punto de la superficie a la altura y, en el azimut az (0 = frente), desplazado `offset` hacia afuera. */
export function surfaceAtHeight(az, y, offset = 0) {
  const o = new THREE.Vector3(0, y, CENTER.z), d = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
  let t = 2;
  for (let i = 0; i < 200; i++) {
    _v.copy(o).addScaledVector(d, t);
    const f = headSDF(_v.x, _v.y, _v.z);
    if (f < 0.0008) break;
    t -= Math.max(f * 0.8, 0.0015);
  }
  const p = o.addScaledVector(d, t);
  const n = headNormal(p);
  return { p: p.addScaledVector(n, offset), n };
}

/** Curva de diadema sobre la línea del pelo (más alta adelante, baja hacia las sienes). */
function bandCurve(yFront, ySide, azMax, offset) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const az = (i / 24 * 2 - 1) * azMax;
    const k = (az / azMax) ** 2;
    pts.push(surfaceAtHeight(az, yFront + (ySide - yFront) * k, offset).p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function teardropGeometry(w, h, depth) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(Math.sin(t) * Math.pow(Math.sin(t / 2), 1.2) * w, -Math.cos(t) * h * 0.5));
  }
  const g = new THREE.LatheGeometry(pts, 10);
  g.scale(1, 1, depth / w);
  g.rotateZ(Math.PI);
  return g;
}

function crescentGeometry(R) {
  const r = R * 0.86, d = R * 0.5;
  const yi = (R * R - r * r + d * d) / (2 * d), xi = Math.sqrt(Math.max(0, R * R - yi * yi));
  const aR = Math.atan2(yi, xi), aL = Math.PI - aR;
  const bL = Math.atan2(yi - d, -xi), bR = Math.atan2(yi - d, xi);
  const s = new THREE.Shape();
  s.absarc(0, 0, R, aR, aL, true);
  s.absarc(0, d, r, bL, bR, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: R * 0.15, bevelEnabled: true, bevelThickness: R * 0.08, bevelSize: R * 0.06, bevelSegments: 2, curveSegments: 28 });
  g.center();
  return g;
}

function spikeGeometry(len, rad, sides = 5) {
  const g = new THREE.ConeGeometry(rad, len, sides);
  g.translate(0, len / 2, 0);
  return g;
}

function gemGeometry(len, rad) {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(rad, len / 2, rad * 0.7);
  g.translate(0, len / 2, 0);
  return g;
}

/** Orienta un objeto para que su +y apunte a `dir` y su +z hacia `facing`. */
function orient(obj, pos, dir, facing = new THREE.Vector3(0, 0, 1)) {
  const y = dir.clone().normalize();
  const x = new THREE.Vector3().crossVectors(y, facing).normalize();
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  obj.position.copy(pos);
  return obj;
}

/**
 * Construye el tocado de una figura. mats = { gold, gem, gem2 }.
 * Devuelve un Group en coordenadas de la cabeza.
 */
export function buildHeaddress(type, mats, seed = 1) {
  const g = new THREE.Group();
  g.name = `tocado (${type})`;
  if (type === 'ninguno') return g;
  const rnd = rng(seed * 31 + 7);
  const band = bandCurve(0.84, 0.42, 1.45, 0.095);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(band, 80, 0.024, 8), mats.gold); tube.name = 'diadema';
  g.add(tube);
  const band2 = bandCurve(0.92, 0.5, 1.4, 0.1);
  const tube2 = new THREE.Mesh(new THREE.TubeGeometry(band2, 80, 0.012, 6), mats.gold); tube2.name = 'diadema fina';
  g.add(tube2);
  // cuentas sobre la diadema
  const beadGeo = new THREE.IcosahedronGeometry(0.02, 0);
  const beads = new THREE.InstancedMesh(beadGeo, mats.gem2, 36); beads.name = 'cuentas';
  const m = new THREE.Matrix4();
  for (let i = 0; i < 36; i++) {
    const p = band.getPointAt((i + 0.5) / 36);
    m.compose(p.add(headNormal(p, _v).multiplyScalar(0.02)), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + 0.4 * (i % 2)));
    beads.setMatrixAt(i, m);
  }
  g.add(beads);
  const front = band.getPointAt(0.5);
  const fn = headNormal(front);

  if (type === 'luna') {
    // lágrima con luna creciente en la frente
    const drop = new THREE.Mesh(teardropGeometry(0.075, 0.24, 0.04), mats.gem); drop.name = 'lágrima';
    drop.position.copy(front).add(new THREE.Vector3(0, -0.12, 0.03));
    drop.lookAt(drop.position.clone().add(fn)); drop.rotateZ(Math.PI);
    const moon = new THREE.Mesh(crescentGeometry(0.075), mats.gold); moon.name = 'luna creciente';
    moon.position.copy(front).add(new THREE.Vector3(0, -0.17, 0.065));
    moon.lookAt(moon.position.clone().add(fn));
    g.add(drop, moon);
    // alas de gemas a los costados
    for (const side of [-1, 1]) {
      const base = band.getPointAt(0.5 + side * 0.24);
      const n = headNormal(base);
      const wing = new THREE.Group(); wing.name = side > 0 ? 'ala izq' : 'ala der';
      const lens = [0.5, 0.42, 0.34, 0.28, 0.22, 0.17, 0.13];
      lens.forEach((L, i) => {
        const ang = 0.15 + i * 0.2;
        const dir = new THREE.Vector3(side * Math.sin(ang), Math.cos(ang), 0).addScaledVector(n, 0.35);
        const sp = new THREE.Mesh(i % 2 ? spikeGeometry(L * 0.9, 0.018) : gemGeometry(L, 0.03), i % 2 ? mats.gold : mats.gem);
        orient(sp, base.clone().addScaledVector(n, 0.02), dir, n);
        wing.add(sp);
      });
      const cab = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mats.gem2); cab.scale.set(1, 1.3, 0.6);
      cab.position.copy(base).addScaledVector(n, 0.03); cab.lookAt(cab.position.clone().add(n));
      wing.add(cab);
      g.add(wing);
    }
  } else if (type === 'sol') {
    const center = new THREE.Vector3(0, 0.35, -0.42);
    const rays = new THREE.Group(); rays.name = 'rayos';
    for (let i = 0; i < 27; i++) {
      const a = (i / 26 - 0.5) * Math.PI * 1.25;
      const L = (i % 2 ? 0.55 : 1.05) * (0.85 + 0.3 * rnd());
      const dir = new THREE.Vector3(Math.sin(a), Math.cos(a), 0);
      const sp = new THREE.Mesh(spikeGeometry(L, i % 2 ? 0.022 : 0.032, 4), mats.gold);
      orient(sp, center.clone().addScaledVector(dir, 1.02), dir);
      rays.add(sp);
      if (i % 2 === 0) {
        const tip = new THREE.Mesh(beadGeo, mats.gem); tip.scale.setScalar(1.4);
        tip.position.copy(center).addScaledVector(dir, 1.02 + L + 0.03);
        rays.add(tip);
      }
    }
    const disc = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.025, 8, 90, Math.PI * 1.25), mats.gold); disc.name = 'aro solar';
    disc.position.copy(center); disc.rotation.z = Math.PI / 2 - (Math.PI * 1.25) / 2;
    g.add(rays, disc);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), mats.gem); sun.name = 'sol'; sun.scale.set(1, 1, 0.5);
    sun.position.copy(front).add(new THREE.Vector3(0, -0.1, 0.04)); sun.lookAt(sun.position.clone().add(fn));
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 24), mats.gold);
    bezel.position.copy(sun.position); bezel.quaternion.copy(sun.quaternion);
    g.add(sun, bezel);
  } else if (type === 'espinas') {
    const crown = new THREE.Group(); crown.name = 'púas';
    const n = 15;
    for (let i = 0; i < n; i++) {
      const u = 0.12 + (i / (n - 1)) * 0.76;
      const p = band.getPointAt(u);
      const nn = headNormal(p);
      const c = Math.abs(u - 0.5);
      const L = (0.62 - c * 0.9) * (i % 2 ? 0.6 : 1);
      const dir = new THREE.Vector3(0, 1, 0).addScaledVector(nn, 0.45);
      const sp = new THREE.Mesh(spikeGeometry(L, 0.03, 5), i % 2 ? mats.gold : mats.gem);
      orient(sp, p, dir, nn);
      crown.add(sp);
      const tip = new THREE.Mesh(beadGeo, mats.gem2); tip.scale.setScalar(1.3);
      tip.position.copy(p).addScaledVector(dir.normalize(), L + 0.02);
      crown.add(tip);
    }
    g.add(crown);
    const drop = new THREE.Mesh(teardropGeometry(0.05, 0.16, 0.03), mats.gem2); drop.name = 'lágrima';
    drop.position.copy(front).add(new THREE.Vector3(0, -0.1, 0.03)); drop.lookAt(drop.position.clone().add(fn)); drop.rotateZ(Math.PI);
    g.add(drop);
  }
  return g;
}

/** Aro colgante. Devuelve { group (pivote en el lóbulo), swing } */
export function buildEarring(side, mats) {
  const pivot = new THREE.Group(); pivot.name = side > 0 ? 'aro izq' : 'aro der';
  pivot.position.set(side * 0.7, -0.31, -0.1);
  const bead = new THREE.SphereGeometry(0.02, 8, 6);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(bead, i % 2 ? mats.gem2 : mats.gold);
    b.position.set(0, -0.03 - i * 0.055, 0); b.scale.setScalar(i === 2 ? 1.4 : 1);
    pivot.add(b);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 20), mats.gold);
  ring.position.set(0, -0.34, 0); ring.rotation.y = Math.PI / 2;
  const drop = new THREE.Mesh(teardropGeometry(0.045, 0.14, 0.03), mats.gem);
  drop.position.set(0, -0.44, 0); drop.rotation.y = side * Math.PI / 2;
  pivot.add(ring, drop);
  for (let i = -1; i <= 1; i++) {
    const s = new THREE.Mesh(spikeGeometry(0.09, 0.01, 4), mats.gold);
    s.rotation.z = Math.PI + i * 0.35; s.position.set(0, -0.5, 0);
    pivot.add(s);
  }
  return pivot;
}

/** Gargantilla con abanico de gemas (pavo real), en coordenadas del busto. */
export function buildChoker(mats) {
  const g = new THREE.Group(); g.name = 'gargantilla';
  const y = -1.8, cz = -0.15, R = 0.458;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.03, 8, 64), mats.gold);
  ring.position.set(0, y, cz); ring.rotation.x = Math.PI / 2 + 0.06;
  g.add(ring);
  const gem = new THREE.IcosahedronGeometry(0.028, 0);
  const row = new THREE.InstancedMesh(gem, mats.gem2, 17);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 17; i++) {
    const a = (i / 16 - 0.5) * Math.PI * 0.95;
    m.makeTranslation(Math.sin(a) * (R + 0.025), y - 0.01, cz + Math.cos(a) * (R + 0.025));
    row.setMatrixAt(i, m);
  }
  g.add(row);
  const fan = new THREE.Group(); fan.name = 'abanico';
  const fc = new THREE.Vector3(0, y - 0.06, cz + R + 0.05);
  for (let i = 0; i < 11; i++) {
    const a = (i / 10 - 0.5) * 2.3;
    const L = 0.1 + 0.15 * Math.cos(a * 0.7) ** 2;
    const dir = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0.15);
    const sp = new THREE.Mesh(gemGeometry(L, 0.028), i % 2 ? mats.gem : mats.gem2);
    orient(sp, fc.clone().addScaledVector(dir.clone().normalize(), 0.05), dir);
    fan.add(sp);
  }
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), mats.gem); heart.scale.set(1, 1.25, 0.6); heart.position.copy(fc).add(new THREE.Vector3(0, -0.04, 0.03));
  const bez = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 24), mats.gold); bez.position.copy(heart.position); bez.scale.set(1, 1.25, 1);
  fan.add(heart, bez);
  g.add(fan);
  return g;
}

/** Pedrería sobre la prenda: toma vértices del busto con máscara de prenda. */
export function buildGarmentGems(body, mats, count = 260, seed = 3) {
  const rnd = rng(seed);
  const P = body.position, N = body.normal, M = body.masks;
  const cand = [];
  for (let i = 0; i < P.length / 3; i++) if (M[i * 4] > 0.6 && P[i * 3 + 1] > -4.3 && N[i * 3 + 2] > -0.2) cand.push(i);
  const inst = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), mats.gem2, Math.min(count, cand.length));
  inst.name = 'pedrería';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1);
  const color = new THREE.Color();
  for (let k = 0; k < inst.count; k++) {
    const i = cand[Math.floor(rnd() * cand.length)];
    const p = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    const n = new THREE.Vector3(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    q.setFromUnitVectors(up, n);
    const s = 0.012 + rnd() * 0.022;
    m.compose(p.addScaledVector(n, s * 0.3), q, new THREE.Vector3(s, s, s * 0.6));
    inst.setMatrixAt(k, m);
    inst.setColorAt(k, color.setHSL(rnd(), 0.2, 0.8 + rnd() * 0.2));
  }
  return inst;
}
