/**
 * Pelo por hebras: cada mechón nace en el cuero cabelludo y "crece" paso a
 * paso con gravedad, deslizándose sobre la cabeza y el busto (colisión con
 * las SDF de anatomy.js). Después se convierte en cintas planas (como las
 * "hair cards" de los juegos) con tangente para el brillo anisotrópico.
 *
 * Estilos:
 *   flequillo  corte hime: flequillo recto a la altura de las cejas,
 *              mechones laterales hasta el mentón y pelo largo atrás (ref. 1)
 *   ondas      raya al medio, ondas largas que caen detrás de los hombros (ref. 2)
 */
import { headSDF, bodySDF } from './anatomy.js';

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const F = (x, y, z) => Math.min(headSDF(x, y, z), bodySDF(x, y, z));
const CENTER = [0, 0.3, -0.12];

function grad(x, y, z, out, e = 0.006) {
  out[0] = F(x + e, y, z) - F(x - e, y, z);
  out[1] = F(x, y + e, z) - F(x, y - e, z);
  out[2] = F(x, y, z + e) - F(x, y, z - e);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };

/** Punto de la superficie de la cabeza en la dirección (az, el) desde el centro del cráneo. */
function scalp(az, el) {
  const d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  let t = 2.2;
  for (let i = 0; i < 200; i++) {
    const p = [CENTER[0] + d[0] * t, CENTER[1] + d[1] * t, CENTER[2] + d[2] * t];
    const f = headSDF(p[0], p[1], p[2]);
    if (f < 0.001) return p;
    t -= Math.max(f * 0.8, 0.002);
    if (t < 0) break;
  }
  return [CENTER[0] + d[0], CENTER[1] + d[1], CENTER[2] + d[2]];
}

/** Proyecta v sobre el plano tangente de normal n. */
function tangent(v, n) { const k = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]; return norm([v[0] - n[0] * k, v[1] - n[1] * k, v[2] - n[2] * k]); }

function grow(root, dir0, o) {
  const n = [0, 0, 0];
  grad(root[0], root[1], root[2], n);
  let p = [root[0] + n[0] * o.offset, root[1] + n[1] * o.offset, root[2] + n[2] * o.offset];
  let d = tangent(dir0, n);
  const pts = [p.slice()];
  let len = 0;
  while (len < o.maxLen) {
    d[1] -= o.gravity * o.step;
    if (o.back) d[2] -= o.back * o.step * smooth(-0.6, -1.5, p[1]);
    if (o.spread) d[0] += o.spread * o.step * Math.sign(p[0]) * smooth(-0.9, -1.8, p[1]);
    norm(d);
    const q = [p[0] + d[0] * o.step, p[1] + d[1] * o.step, p[2] + d[2] * o.step];
    const fv = F(q[0], q[1], q[2]);
    if (fv < o.offset) { grad(q[0], q[1], q[2], n); const k = o.offset - fv; q[0] += n[0] * k; q[1] += n[1] * k; q[2] += n[2] * k; }
    d = norm([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
    p = q; len += o.step;
    pts.push(p.slice());
    if (o.cut(p, len)) break;
  }
  return pts;
}

/** Genera los mechones de un estilo. density 0.3..1.5 escala la cantidad. */
export function growHair(style = 'flequillo', density = 1, seed = 1) {
  const rnd = mulberry(seed * 977 + (style === 'ondas' ? 13 : 0));
  const strands = [];
  const add = (pts, width, blunt, wave = 0) => { if (pts.length > 3) strands.push({ pts, width, blunt, wave, r: rnd() }); };
  const N = (n) => Math.max(4, Math.round(n * density));

  if (style === 'flequillo') {
    // flequillo
    const nb = N(170);
    for (let i = 0; i < nb; i++) {
      const a = (i / (nb - 1)) * 2 - 1 + (rnd() - 0.5) * 0.02;
      const az = a * 1.08, el = 1.0 + rnd() * 0.25;
      const layer = i % 3;
      // corte recto a la altura de las cejas; en los extremos baja de golpe hasta el pómulo
      const cutY = Math.abs(a) < 0.84 ? 0.33 + 0.012 * Math.sin(i * 1.7) : -0.3 - rnd() * 0.05;
      add(grow(scalp(az, el), [Math.sin(az) * 0.15, -0.3, 1], {
        step: 0.03, maxLen: 2.2, offset: 0.022 + layer * 0.014, gravity: 0.9,
        cut: (p) => p[1] < cutY && p[2] > -0.1,
      }), 0.065, true);
    }
    // mechones laterales (hime) hasta el mentón
    for (const side of [-1, 1]) {
      const ns = N(110);
      for (let i = 0; i < ns; i++) {
        const az = side * (0.86 + rnd() * 0.62), el = 0.3 + rnd() * 0.85;
        const cutY = -1.08 - rnd() * 0.04;
        add(grow(scalp(az, el), [0, -1, 0.15], {
          step: 0.035, maxLen: 2.6, offset: 0.05 + (i % 3) * 0.02, gravity: 1.2,
          cut: (p) => p[1] < cutY,
        }), 0.075, true);
      }
    }
    // pelo largo atrás
    const nback = N(620);
    for (let i = 0; i < nback; i++) {
      let az = (rnd() * 2 - 1) * Math.PI, el;
      if (Math.abs(az) < 1.15) el = 1.28 + rnd() * 0.28; else el = 0.05 + rnd() * 1.45;
      const crown = Math.abs(az) < 1.15;
      const cutY = -3.3 - rnd() * 0.5;
      add(grow(scalp(az, el), crown ? [0, -0.2, -1] : [0, -1, -0.1], {
        step: 0.04, maxLen: 5, offset: 0.03 + (i % 4) * 0.014, gravity: 1, back: 0.55,
        cut: (p) => p[1] < cutY,
      }), 0.11, false);
    }
  } else {
    // ondas: raya al medio
    const n = N(760);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const az = side * (0.04 + rnd() * (Math.PI - 0.04));
      const front = Math.abs(az) < 1.2;
      const el = front ? 0.62 + rnd() * 0.9 : 0.1 + rnd() * 1.4;
      const dir = front ? [side * 0.9, -0.5, -0.45] : [0, -1, -0.15];
      const free = rnd() < 0.12;
      const cutY = -2.7 - rnd() * 0.7;
      add(grow(scalp(az, el), dir, {
        step: 0.04, maxLen: 4.6, offset: 0.035 + (i % 4) * 0.016, gravity: 1, back: free ? 0 : 0.5, spread: 0.35,
        cut: (p) => p[1] < cutY,
      }), 0.11, false, 1);
    }
  }
  return ribbons(strands);
}

/** Convierte mechones en cintas (dos vértices por punto). */
function ribbons(strands) {
  let nv = 0, ni = 0;
  const plan = strands.map((s) => {
    const k = Math.max(1, Math.round(0.07 / Math.hypot(s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1], s.pts[1][2] - s.pts[0][2])));
    const pts = s.pts.filter((_, i) => i % k === 0 || i === s.pts.length - 1);
    nv += pts.length * 2; ni += (pts.length - 1) * 6;
    return { ...s, pts };
  });
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), tangentA = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2), strand = new Float32Array(nv * 2);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, ii = 0;
  const n = [0, 0, 0];
  for (const s of plan) {
    const P = s.pts, L = P.length;
    let total = 0; for (let i = 1; i < L; i++) total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
    let acc = 0;
    const base = v;
    for (let i = 0; i < L; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(L - 1, i + 1)];
      const T = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      if (i > 0) acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
      const t = total > 0 ? acc / total : 0;
      grad(P[i][0], P[i][1], P[i][2], n);
      let S = [T[1] * n[2] - T[2] * n[1], T[2] * n[0] - T[0] * n[2], T[0] * n[1] - T[1] * n[0]];
      if (Math.hypot(S[0], S[1], S[2]) < 1e-3) S = [1, 0, 0];
      norm(S);
      const taper = s.blunt ? 1 - 0.45 * smooth(0.85, 1, t) : 1 - 0.88 * smooth(0.55, 1, t);
      const w = s.width * taper * (0.75 + 0.5 * s.r) * 0.5;
      // ondas: desplazamiento lateral y hacia afuera que crece con el largo
      let ox = 0, oy = 0, oz = 0;
      if (s.wave) {
        const amp = 0.07 * smooth(0.6, 1.6, acc), ph = acc * 11 + s.r * 0.8;
        const wv = Math.sin(ph) * amp, wo = Math.cos(ph * 0.5) * amp * 0.6;
        ox = S[0] * wv + n[0] * wo; oy = S[1] * wv + n[1] * wo; oz = S[2] * wv + n[2] * wo;
      }
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        position[v * 3] = P[i][0] + ox + S[0] * w * sg;
        position[v * 3 + 1] = P[i][1] + oy + S[1] * w * sg;
        position[v * 3 + 2] = P[i][2] + oz + S[2] * w * sg;
        normal.set(n, v * 3); tangentA.set(T, v * 3);
        uv[v * 2] = side; uv[v * 2 + 1] = t;
        strand[v * 2] = s.r; strand[v * 2 + 1] = total;
        v++;
      }
      if (i < L - 1) {
        const a0 = base + i * 2;
        index[ii++] = a0; index[ii++] = a0 + 1; index[ii++] = a0 + 2;
        index[ii++] = a0 + 1; index[ii++] = a0 + 3; index[ii++] = a0 + 2;
      }
    }
  }
  return { position, normal, tangent: tangentA, uv, strand, index, count: plan.length };
}
