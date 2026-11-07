/**
 * Anatomía procedural de las diosas: funciones implícitas (SDF aproximadas)
 * de la cabeza y del busto, en coordenadas locales de la cabeza.
 *
 *   unidades ≈ decímetros (la cabeza mide ~2.2 de mentón a coronilla)
 *   +y arriba, +z hacia adelante (hacia donde mira la cara), origen a la
 *   altura de los ojos, en el centro del cráneo.
 *
 * Son JS puro (sin three) para poder evaluarlas millones de veces al mallar
 * y también desde un worker o desde node. Todo lo que cambia la forma está
 * acá; el mallador (mesher.js) solo necesita una función f(x, y, z) < 0 adentro.
 */

// ---------- constantes compartidas con la escena ----------
export const EYE = { x: 0.305, y: 0.0, z: 0.585, r: 0.152 };
/** Apertura del párpado (ángulos en radianes, en el espacio del ojo). */
export const LID = {
  inner: -1.02,  // comisura interna (θ, hacia la nariz)
  outer: 1.1,    // comisura externa
  up: 0.68,      // altura máxima del párpado superior (φ)
  low: 0.44,     // profundidad del párpado inferior
  tilt: 0.16,    // ojo rasgado: la comisura externa sube
  shell: 1.1,    // radio del párpado (× r del ojo)
};
export const NECK_PIVOT = { x: 0, y: -1.25, z: -0.16 };
export const HEAD_BOUNDS = { min: [-0.92, -2.15, -1.12], max: [0.92, 1.28, 1.16] };
export const BODY_BOUNDS = { min: [-2.25, -4.75, -1.2], max: [2.25, -1.3, 1.05] };

// ---------- primitivas ----------
const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max, atan2 = Math.atan2;

export function sdEllipsoid(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -min(rx, ry, rz);
}

export function sdSphere(x, y, z, r) { return sqrt(x * x + y * y + z * z) - r; }

/** Cono redondeado entre a (radio r1) y b (radio r2). */
export function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const z = yy - l2;
  const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yy * yy * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}

export function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return sqrt(dx * dx + dy * dy + dz * dz) - r;
}

export function smin(a, b, k) {
  if (k <= 0) return min(a, b);
  const h = max(k - abs(a - b), 0) / k;
  return min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

/**
 * Labio: barrido de elipses (en y, z) a lo largo de x, que se angosta hacia
 * las comisuras y se curva hacia atrás siguiendo el arco dental.
 */
export function sdLip(x, y, z, yc, z0, W, ry0, rz0, bow) {
  const ax = abs(x), t = ax / W;
  const w = sqrt(max(0, 1 - Math.min(t, 1) ** 2));
  let ry = ry0 * Math.pow(w, 0.7) + 0.003;
  const rz = rz0 * Math.pow(w, 0.5) + 0.006;
  if (bow) ry *= 1 + bow(ax);
  const zc = z0 - 0.6 * x * x;
  const yy = (y - yc) / ry, zz = (z - zc) / rz;
  let d = (sqrt(yy * yy + zz * zz) - 1) * min(ry, rz);
  if (t > 1) d = max(d, (t - 1) * W);
  return d;
}

const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------- ojo: apertura almendrada en coordenadas angulares ----------
/**
 * Devuelve la distancia angular (rad, negativa adentro) a la abertura del
 * párpado para un punto relativo al centro del ojo derecho/izquierdo ya
 * reflejado a x > 0 (lateral positivo).
 */
export function apertureAngle(dx, dy, dz) {
  const th = atan2(dx, dz);
  const ph = atan2(dy, sqrt(dx * dx + dz * dz)) - LID.tilt * th;
  const c = (LID.inner + LID.outer) * 0.5, hw = (LID.outer - LID.inner) * 0.5;
  const u = (th - c) / hw;
  const w = max(0, 1 - u * u);
  // el arco superior tiene su pico un poco hacia adentro, el inferior hacia afuera
  const up = LID.up * Math.pow(w, 0.62) * (1 + 0.12 * (-u));
  const lo = -LID.low * Math.pow(w, 0.85) * (1 + 0.1 * u);
  return max(ph - up, lo - ph, (abs(u) - 1) * hw);
}

/** Curva del borde del párpado superior (φ en función de θ) — para pestañas y párpado móvil. */
export function upperLidPhi(th) {
  const c = (LID.inner + LID.outer) * 0.5, hw = (LID.outer - LID.inner) * 0.5;
  const u = (th - c) / hw, w = max(0, 1 - u * u);
  return LID.up * Math.pow(w, 0.62) * (1 + 0.12 * (-u)) + LID.tilt * th;
}
export function lowerLidPhi(th) {
  const c = (LID.inner + LID.outer) * 0.5, hw = (LID.outer - LID.inner) * 0.5;
  const u = (th - c) / hw, w = max(0, 1 - u * u);
  return -LID.low * Math.pow(w, 0.85) * (1 + 0.1 * u) + LID.tilt * th;
}

// ---------- cabeza ----------
/**
 * SDF de la cabeza + cuello. `shape` permite variar la identidad de cada
 * diosa (todo cerca de 0 = forma base).
 */
export function headSDF(x, y, z, s = DEFAULT_SHAPE) {
  const ax = abs(x);

  // cráneo
  let d = sdEllipsoid(x, y - 0.26, z + 0.12, 0.73, 0.85, 0.92);

  // masa de la cara: se angosta hacia el mentón (rostro en "V")
  const taper = smoothstep(-0.25, -1.05, y);
  const fx = x * (1 + (0.5 + s.jaw) * taper);
  const face = sdEllipsoid(fx, y + 0.24, z - 0.1, 0.67, 0.8, 0.74);
  d = smin(d, face, 0.22);

  // pómulos
  d = smin(d, sdEllipsoid(ax - 0.39, y + 0.14 - s.cheek * 0.05, z - 0.42, 0.23, 0.17, 0.24), 0.16);
  // ángulo de la mandíbula
  d = smin(d, sdEllipsoid(ax - 0.37, y + 0.66, z + 0.05, 0.14, 0.21, 0.28), 0.22);
  // mentón
  d = smin(d, sdEllipsoid(x, y + 0.9, z - 0.6, 0.16, 0.13, 0.15), 0.18);
  // hocico: volumen alrededor de la boca donde se apoyan los labios
  d = smin(d, sdEllipsoid(x, y + 0.6, z - 0.55, 0.28, 0.26, 0.2), 0.16);
  // frente un poco más plana y alta
  d = smin(d, sdEllipsoid(x, y - 0.5, z - 0.38, 0.52, 0.42, 0.38), 0.2);

  // cuencas de los ojos
  d = smax(d, -sdEllipsoid(ax - EYE.x, y - 0.03, z - 0.72, 0.2, 0.15, 0.13), 0.14);
  // arco ciliar suave
  d = smin(d, sdEllipsoid(ax - 0.29, y - 0.26, z - 0.6, 0.24, 0.07, 0.11), 0.14);

  // nariz: puente, punta, aletas, columela
  d = smin(d, sdRoundCone(x, y, z, 0, 0.12, 0.69, 0, -0.33, 0.925, 0.042, 0.055), 0.08);
  d = smin(d, sdSphere(x, y + 0.36 + s.nose * 0.03, z - 0.925, 0.058), 0.04);
  d = smin(d, sdEllipsoid(ax - 0.062, y + 0.405, z - 0.835, 0.038, 0.034, 0.044), 0.075);

  // labios: barridos que siguen el arco dental, con arco de cupido
  const lipFull = 1 + s.lips;
  const bowUp = (ax) => 0.28 * Math.exp(-(((ax - 0.045) / 0.03) ** 2)) - 0.18 * Math.exp(-((ax / 0.016) ** 2));
  const bowLo = (ax) => 0.18 * Math.exp(-(((ax - 0.05) / 0.05) ** 2));
  let lips = sdLip(x, y, z, -0.592, 0.805, 0.172, 0.04 * lipFull, 0.064 * lipFull, bowUp);
  lips = smin(lips, sdLip(x, y, z, -0.672, 0.797, 0.155, 0.054 * lipFull, 0.072 * lipFull, bowLo), 0.012);
  d = smin(d, lips, 0.04);
  // línea de la boca y comisuras
  d = smax(d, -sdLip(x, y + 0.08 * x * x, z, -0.626, 0.797, 0.158, 0.0045, 0.075, null), 0.008);

  // orejas
  d = smin(d, sdEllipsoid(ax - 0.685, y + 0.1, z + 0.14, 0.04, 0.25, 0.13), 0.06);

  // cuello
  d = smin(d, sdRoundCone(x, y, z, 0, -0.55, -0.22, 0, -2.1, -0.1, 0.395, 0.44), 0.2);

  // párpados: casquete alrededor del ojo, con la abertura almendrada
  const ex = ax - EYE.x, ey = y - EYE.y, ez = z - EYE.z;
  const er = sqrt(ex * ex + ey * ey + ez * ez);
  d = smin(d, er - EYE.r * LID.shell, 0.08);
  if (er < EYE.r * 1.6) {
    const a = apertureAngle(ex, ey, ez) * er;
    d = smax(d, -max(a, er - EYE.r * 1.32), 0.012);
  }
  return d;
}

export const DEFAULT_SHAPE = { jaw: 0, cheek: 0, nose: 0, lips: 0.08 };

// ---------- busto ----------
export function bodySDF(x, y, z) {
  const ax = abs(x);
  // cuello (base): un poco más ancho que el de la cabeza, para tapar la unión
  let d = sdRoundCone(x, y, z, 0, -1.6, -0.16, 0, -2.25, -0.12, 0.39, 0.52);
  // trapecios
  d = smin(d, sdCapsule(ax, y, z, 0.2, -1.75, -0.3, 1.15, -2.22, -0.32, 0.2), 0.3);
  // torso
  d = smin(d, sdEllipsoid(x, y + 3.05, z + 0.22, 1.42, 1.05, 0.68), 0.35);
  // hombros
  d = smin(d, sdEllipsoid(ax - 1.28, y + 2.4, z + 0.28, 0.44, 0.34, 0.42), 0.25);
  // brazos
  d = smin(d, sdRoundCone(ax, y, z, 1.45, -2.55, -0.28, 1.68, -4.9, -0.3, 0.36, 0.3), 0.18);
  // clavículas
  d = smin(d, sdCapsule(ax, y, z, 0.1, -2.08, 0.2, 0.95, -2.14, -0.02, 0.055), 0.12);
  // pecho
  d = smin(d, sdEllipsoid(ax - 0.5, y + 3.4, z - 0.2, 0.5, 0.46, 0.42), 0.22);
  // hueco esternal
  d = smax(d, -sdSphere(x, y + 2.1, z - 0.3, 0.07), 0.08);
  // corte inferior
  d = max(d, -(y + 4.7));
  return d;
}

// ---------- máscaras de maquillaje / materiales (se hornean por vértice) ----------
/**
 * Devuelve [labios, sombra de ojos, rubor, tercer ojo] en 0..1 para un punto de la
 * superficie de la cabeza. La escena las usa como atributos de vértice.
 */
export function headMasks(x, y, z, out) {
  const ax = abs(x);
  // labios: cerca de los elipsoides de los labios y por delante
  const l1 = sdLip(x, y, z, -0.592, 0.805, 0.18, 0.05, 0.075, null);
  const l2 = sdLip(x, y, z, -0.672, 0.797, 0.165, 0.064, 0.08, null);
  out[0] = smoothstep(0.012, -0.004, min(l1, l2)) * smoothstep(0.62, 0.72, z);
  // sombra de ojos: arco sobre el ojo que se estira hacia la sien (ojo de zorro)
  const ex = ax - EYE.x, ey = y - EYE.y;
  const lid = smoothstep(0.3, 0.1, sqrt((ex * 0.85) ** 2 + ((ey - 0.08 - ex * 0.35) * 1.6) ** 2)) * smoothstep(-0.06, 0.05, ey - ex * 0.25);
  const wing = smoothstep(0.06, 0.0, abs(ey - 0.03 - (ex - 0.12) * 0.55)) * smoothstep(0.1, 0.18, ex) * smoothstep(0.42, 0.26, ex);
  const under = smoothstep(0.05, 0.0, abs(ey + 0.12 + ex * ex * 0.6)) * smoothstep(0.22, 0.04, abs(ex - 0.04));
  out[1] = Math.min(1, lid + wing * 0.9 + under * 0.35) * smoothstep(0.5, 0.62, z);
  // rubor
  out[2] = smoothstep(0.28, 0.0, sqrt((ax - 0.42) ** 2 + ((y + 0.28) * 1.3) ** 2)) * smoothstep(0.35, 0.55, z);
  // tercer ojo: zona entre las cejas (brilla con el pulso)
  out[3] = smoothstep(0.11, 0.0, sqrt(x * x + ((y - 0.36) * 0.8) ** 2)) * smoothstep(0.6, 0.72, z);
  return out;
}

/** Máscaras del busto: [prenda, tatuaje/filigrana, 0, 0]. */
export function bodyMasks(x, y, z, out) {
  const ax = abs(x);
  // escote en V con hombros descubiertos
  const neckline = -2.75 - 0.55 * smoothstep(0.0, 0.5, 0.5 - ax) + 0.25 * ax;
  out[0] = smoothstep(0.03, -0.03, y - neckline);
  // filigrana sobre clavículas y hombros
  out[1] = smoothstep(0.35, 0.0, abs(y + 2.45 - ax * 0.05)) * (1 - out[0]);
  out[2] = 0; out[3] = 0;
  return out;
}
