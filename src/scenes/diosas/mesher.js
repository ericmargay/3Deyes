/**
 * Mallado de funciones implícitas con "surface nets" en banda estrecha.
 *
 *  1. grilla gruesa (4 celdas finas por lado) para encontrar la superficie
 *  2. solo los bloques cerca de la superficie se evalúan en la grilla fina
 *  3. un vértice por celda con cambio de signo (promedio de los cruces)
 *  4. un paso de Newton para pegar cada vértice a la superficie exacta
 *  5. normales por gradiente, oclusión ambiental y máscaras horneadas
 *
 * JS puro: corre en el worker (diosas.worker.js) o en node.
 */

export function meshImplicit(fn, bounds, cell, opts = {}) {
  const B = 4;                    // celdas finas por bloque grueso
  const [x0, y0, z0] = bounds.min;
  const nx = Math.ceil((bounds.max[0] - x0) / cell / B) * B;
  const ny = Math.ceil((bounds.max[1] - y0) / cell / B) * B;
  const nz = Math.ceil((bounds.max[2] - z0) / cell / B) * B;
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1;
  const bx = nx / B, by = ny / B, bz = nz / B;
  const C = cell * B;

  // 1. grilla gruesa
  const coarse = new Float32Array((bx + 1) * (by + 1) * (bz + 1));
  const ci = (i, j, k) => i + (bx + 1) * (j + (by + 1) * k);
  for (let k = 0; k <= bz; k++) for (let j = 0; j <= by; j++) for (let i = 0; i <= bx; i++) coarse[ci(i, j, k)] = fn(x0 + i * C, y0 + j * C, z0 + k * C);

  // 2. grilla fina solo en bloques activos (NaN = sin evaluar)
  const vals = new Float32Array(NX * NY * NZ).fill(NaN);
  const vi = (i, j, k) => i + NX * (j + NY * k);
  const band = C * 1.8;
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    let mn = Infinity, pos = false, neg = false;
    for (let c = 0; c < 8; c++) {
      const v = coarse[ci(I + (c & 1), J + ((c >> 1) & 1), K + ((c >> 2) & 1))];
      mn = Math.min(mn, Math.abs(v)); if (v > 0) pos = true; else neg = true;
    }
    if (!(pos && neg) && mn > band) continue;
    for (let k = K * B; k <= K * B + B; k++) for (let j = J * B; j <= J * B + B; j++) for (let i = I * B; i <= I * B + B; i++) {
      const id = vi(i, j, k);
      if (Number.isNaN(vals[id])) vals[id] = fn(x0 + i * cell, y0 + j * cell, z0 + k * cell);
    }
  }

  // 3. vértices
  const cellVert = new Map();
  const pos = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let mask = 0, ok = true;
    for (let c = 0; c < 8; c++) {
      const v = vals[vi(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
      if (Number.isNaN(v)) { ok = false; break; }
      corner[c] = v; if (v < 0) mask |= 1 << c;
    }
    if (!ok || mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t;
      sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      n++;
    }
    cellVert.set(i + nx * (j + ny * k), pos.length / 3);
    pos.push(x0 + (i + sx / n) * cell, y0 + (j + sy / n) * cell, z0 + (k + sz / n) * cell);
  }

  // caras: por cada arista de la grilla con cambio de signo, un quad con las 4 celdas que la comparten
  const idx = [];
  const cv = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? undefined : cellVert.get(i + nx * (j + ny * k));
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = vals[vi(i, j, k)];
    if (Number.isNaN(v0)) continue;
    const in0 = v0 < 0;
    // arista en x: celdas (i, j-1..j, k-1..k)
    for (let axis = 0; axis < 3; axis++) {
      const i1 = i + (axis === 0), j1 = j + (axis === 1), k1 = k + (axis === 2);
      if (i1 > nx || j1 > ny || k1 > nz) continue;
      const v1 = vals[vi(i1, j1, k1)];
      if (Number.isNaN(v1) || (v1 < 0) === in0) continue;
      let a, b, c, d;
      if (axis === 0) { a = cv(i, j - 1, k - 1); b = cv(i, j, k - 1); c = cv(i, j, k); d = cv(i, j - 1, k); }
      else if (axis === 1) { a = cv(i - 1, j, k - 1); b = cv(i - 1, j, k); c = cv(i, j, k); d = cv(i, j, k - 1); }
      else { a = cv(i - 1, j - 1, k); b = cv(i, j - 1, k); c = cv(i, j, k); d = cv(i - 1, j, k); }
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      if (in0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
  }

  // 4–5. Newton, normales, AO, máscaras
  const nV = pos.length / 3;
  const P = new Float32Array(pos), N = new Float32Array(nV * 3), AO = new Float32Array(nV);
  const masks = opts.masks ? new Float32Array(nV * 4) : null;
  const e = cell * 0.3, maxStep = cell * 0.8;
  const grad = (x, y, z, out) => {
    out[0] = fn(x + e, y, z) - fn(x - e, y, z);
    out[1] = fn(x, y + e, z) - fn(x, y - e, z);
    out[2] = fn(x, y, z + e) - fn(x, y, z - e);
    return out;
  };
  const g = [0, 0, 0], m = [0, 0, 0, 0];
  const aoSteps = opts.aoSteps ?? [0.025, 0.05, 0.1, 0.18, 0.3];
  for (let v = 0; v < nV; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const f = fn(x, y, z);
    grad(x, y, z, g);
    let gl = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    if (gl > 1e-12) {
      // gradiente por diferencias: g = ∇f · 2e
      let s = (f * 2 * e) / gl;
      const len = Math.abs(s) * Math.sqrt(gl);
      if (len > maxStep) s *= maxStep / len;
      x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
      grad(x, y, z, g); gl = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    }
    const il = gl > 1e-12 ? 1 / Math.sqrt(gl) : 0;
    const nx_ = g[0] * il, ny_ = g[1] * il, nz_ = g[2] * il;
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = nx_; N[v * 3 + 1] = ny_; N[v * 3 + 2] = nz_;
    let occ = 0, w = 1;
    for (const h of aoSteps) { occ += Math.max(0, h - fn(x + nx_ * h, y + ny_ * h, z + nz_ * h)) * w / h; w *= 0.75; }
    AO[v] = Math.max(0, Math.min(1, 1 - occ * 0.32));
    if (masks) { opts.masks(x, y, z, m); masks.set(m, v * 4); }
  }
  const index = nV > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { position: P, normal: N, ao: AO, masks, index };
}
