import * as THREE from 'three';

/**
 * Cámara de espejos de un caleidoscopio. Los espejos son paralelos al eje de
 * la vista (z), como en un tubo real, así que cada reflejo es una isometría
 * del plano (x, y) y z no cambia: las copias tienen el estéreo exacto.
 *
 *   roseta      2 espejos a 180°/n: mandala de 2n copias alrededor del centro
 *   equilátero  3 espejos a 60°: teselado infinito (grupo p3m1)
 *   escuadra    triángulo 45-45-90: teselado p4m
 *   cartabón    triángulo 30-60-90: teselado p6m
 *   cuadrado    4 espejos: teselado pmm
 *
 * La cámara fundamental es el recinto donde viven los objetos; cada copia es
 * un reflejo con su ventana (la región que se ve a través de ese espejo), y
 * lo que cae afuera de la ventana no se ve, como en un caleidoscopio de verdad.
 */
export const KALEIDO_MODES = ['roseta', 'equilátero', 'escuadra', 'cartabón', 'cuadrado'];

/** Semiplano a·x + b·y + c ≥ 0 (adentro) para el borde P→Q de un polígono antihorario. */
function halfPlane(P, Q) {
  const a = -(Q.y - P.y), b = Q.x - P.x, l = Math.hypot(a, b);
  return [a / l, b / l, -(a * P.x + b * P.y) / l];
}

/**
 * @param mode   uno de KALEIDO_MODES
 * @param o      { n: pliegues de la roseta, size: lado del triángulo, radius: radio a cubrir, maxCopies }
 * @returns { mode, poly, half, copies: [{ m: [a,b,c,d] (mat2 por columnas), t: [x,y], det, win }], centers, size }
 */
export function makeChamber(mode, { n = 6, size = 3, radius = 16, maxCopies = 320 } = {}) {
  if (mode === 'roseta') {
    const a = Math.PI / n, R = radius * 1.6;
    const poly = [new THREE.Vector2(0, 0), new THREE.Vector2(R, 0), new THREE.Vector2(R * Math.cos(a), R * Math.sin(a))];
    const half = [[0, 1, 0], [Math.sin(a), -Math.cos(a), 0]];
    const copies = [];
    for (let k = 0; k < n; k++) {
      const th = (2 * Math.PI * k) / n, c = Math.cos(th), s = Math.sin(th);
      copies.push({ m: [c, s, -s, c], t: [0, 0], det: 1 });     // rotación: cuña [θ, θ + a]
      copies.push({ m: [c, s, s, -c], t: [0, 0], det: -1 });    // rotación ∘ espejo: cuña [θ − a, θ]
    }
    for (const cp of copies) cp.win = poly.map((p) => apply(cp, p));
    return { mode, n, poly, half, copies, centers: [new THREE.Vector2(0, 0)], size: radius, wedge: a };
  }

  // polígono fundamental (antihorario); el primer vértice es el centro de mayor orden
  let poly;
  if (mode === 'equilátero') poly = [[0, 0], [size, 0], [size / 2, (size * Math.sqrt(3)) / 2]];
  else if (mode === 'escuadra') poly = [[0, 0], [size, 0], [size, size]];
  else if (mode === 'cartabón') poly = [[0, 0], [size, 0], [size, size * Math.tan(Math.PI / 6)]];
  else poly = [[0, 0], [size, 0], [size, size], [0, size]];
  poly = poly.map(([x, y]) => new THREE.Vector2(x, y));
  // centrado: el centro de mayor orden queda en el centro de la pantalla
  const half = poly.map((P, i) => halfPlane(P, poly[(i + 1) % poly.length]));

  // copias por reflexión sucesiva en los bordes (BFS), hasta cubrir el radio pedido
  const key = (w) => { let x = 0, y = 0; for (const p of w) { x += p.x; y += p.y; } return `${Math.round((x / w.length) * 1000)},${Math.round((y / w.length) * 1000)}`; };
  const start = { m: [1, 0, 0, 1], t: [0, 0], det: 1, win: poly.map((p) => p.clone()) };
  const copies = [start], seen = new Set([key(start.win)]);
  for (let qi = 0; qi < copies.length && copies.length < maxCopies; qi++) {
    const q = copies[qi], k = q.win.length;
    for (let e = 0; e < k; e++) {
      const P = q.win[e], Q = q.win[(e + 1) % k];
      const ux = Q.x - P.x, uy = Q.y - P.y, l = Math.hypot(ux, uy), dx = ux / l, dy = uy / l;
      const M = [2 * dx * dx - 1, 2 * dx * dy, 2 * dx * dy, 2 * dy * dy - 1];   // reflexión en la recta por el origen con dirección (dx, dy)
      const refl = (x, y) => [M[0] * (x - P.x) + M[2] * (y - P.y) + P.x, M[1] * (x - P.x) + M[3] * (y - P.y) + P.y];
      const win = q.win.map((p) => { const [x, y] = refl(p.x, p.y); return new THREE.Vector2(x, y); });
      const kk = key(win); if (seen.has(kk)) continue;
      let cx = 0, cy = 0; for (const p of win) { cx += p.x; cy += p.y; } cx /= win.length; cy /= win.length;
      if (Math.hypot(cx, cy) > radius + size) continue;
      seen.add(kk);
      // nueva copia = reflexión ∘ copia anterior
      const A = q.m, m = [M[0] * A[0] + M[2] * A[1], M[1] * A[0] + M[3] * A[1], M[0] * A[2] + M[2] * A[3], M[1] * A[2] + M[3] * A[3]];
      const [tx, ty] = refl(q.t[0], q.t[1]);
      copies.push({ m, t: [tx, ty], det: -q.det, win });
      if (copies.length >= maxCopies) break;
    }
  }
  return { mode, poly, half, copies, centers: poly.map((p) => p.clone()), size };
}

/** Aplica la copia a un punto de la cámara fundamental. */
export function apply(cp, p) {
  const [a, b, c, d] = cp.m;
  return new THREE.Vector2(a * p.x + c * p.y + cp.t[0], b * p.x + d * p.y + cp.t[1]);
}

/** Inversa: punto del mundo → cámara fundamental (la copia es una isometría: Aᵀ(p − t)). */
export function unapply(cp, p) {
  const [a, b, c, d] = cp.m, x = p.x - cp.t[0], y = p.y - cp.t[1];
  return new THREE.Vector2(a * x + b * y, c * x + d * y);
}

/** ¿El punto está adentro del polígono (convexo)? */
export function inside(win, p) {
  let s = 0;
  for (let i = 0; i < win.length; i++) {
    const A = win[i], B = win[(i + 1) % win.length], cr = (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x);
    if (cr !== 0) { if (s === 0) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; }
  }
  return true;
}

/** Punto al azar adentro de la cámara fundamental (para la roseta, entre r0 y r1). */
export function randomInChamber(ch, rnd = Math.random, r0 = 1.6, r1 = null) {
  if (ch.mode === 'roseta') {
    const R1 = r1 ?? ch.size, r = Math.sqrt(r0 * r0 + rnd() * (R1 * R1 - r0 * r0)), a = rnd() * ch.wedge;
    return new THREE.Vector2(r * Math.cos(a), r * Math.sin(a));
  }
  const P = ch.poly;
  if (P.length === 4) return new THREE.Vector2(P[0].x + rnd() * (P[2].x - P[0].x), P[0].y + rnd() * (P[2].y - P[0].y));
  let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
  return new THREE.Vector2(P[0].x + u * (P[1].x - P[0].x) + v * (P[2].x - P[0].x), P[0].y + u * (P[1].y - P[0].y) + v * (P[2].y - P[0].y));
}

/** Punto de la cámara a partir de dos coordenadas 0..1 (u: lejos del centro, v: a lo ancho). */
export function chamberPoint(ch, u, v) {
  if (ch.mode === 'roseta') { const r = 1.8 + u * (ch.size - 1.8), a = (0.06 + v * 0.88) * ch.wedge; return new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)); }
  const P = ch.poly;
  if (P.length === 4) return new THREE.Vector2(P[0].x + (0.06 + u * 0.88) * (P[2].x - P[0].x), P[0].y + (0.06 + v * 0.88) * (P[2].y - P[0].y));
  // del vértice principal hacia el borde opuesto
  const uu = 0.08 + u * 0.86, B = P[1], C = P[2];
  const e = new THREE.Vector2(B.x + (C.x - B.x) * (0.08 + v * 0.84), B.y + (C.y - B.y) * (0.08 + v * 0.84));
  return new THREE.Vector2(P[0].x + (e.x - P[0].x) * uu, P[0].y + (e.y - P[0].y) * uu);
}

/** El punto más cercano en el borde de la cámara (los objetos nacen de las costuras de los espejos). */
export function nearestEdgePoint(ch, p) {
  let best = null, bd = Infinity;
  const P = ch.poly;
  const edges = ch.mode === 'roseta' ? [[P[0], P[1]], [P[0], P[2]]] : P.map((A, i) => [A, P[(i + 1) % P.length]]);
  for (const [A, B] of edges) {
    const ab = new THREE.Vector2().subVectors(B, A), t = THREE.MathUtils.clamp(new THREE.Vector2().subVectors(p, A).dot(ab) / ab.lengthSq(), 0, 1);
    const q = A.clone().addScaledVector(ab, t), d = q.distanceToSquared(p);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
