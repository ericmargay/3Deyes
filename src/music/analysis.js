/**
 * Análisis estructural de un tema completo ("escucha todo antes de dibujar").
 * JS puro: corre en un worker (music/worker.js) o en node (tools/analizar.mjs).
 *
 * Pipeline
 *  1. STFT: ventana Hann de 2048, 100 cuadros por segundo.
 *  2. Por cuadro: energía y flujo espectral en 5 bandas (sub, grave-medio,
 *     medio, agudo, aire), 24 bandas log de timbre, 12 clases de altura
 *     (croma), sonoridad. El flujo compara cada bin con el máximo de sus
 *     vecinos en el cuadro anterior: ignora vibrato y barridos lentos.
 *  3. Onsets por banda: picos con umbral adaptativo; cada uno con su fuerza.
 *  4. Tempo: autocorrelación de la envolvente de onsets; cada candidato suma
 *     también cuánto se repite a 1, 2 y 4 compases (evita el doble / mitad).
 *  5. Beats: programación dinámica (Ellis) sobre la envolvente con un pulso
 *     estable; downbeats agrupando de a 4 por la acentuación grave y los
 *     cambios de timbre y armonía.
 *  6. Secciones: huella por beat (timbre + croma) → matriz de auto-similitud →
 *     novedad con kernel en tablero (Foote) → límites en downbeats; secciones
 *     parecidas reciben el mismo tipo (A, B, C…).
 *  7. Notas: STFT larga (8192, 25 cuadros/s), saliencia por semitono con suma
 *     armónica, seguimiento de notas con ataque y fin.
 *
 * Salida: ver `Analysis` al final (todo arrays planos, transferibles).
 */
import { Spectrum, percentile, pickPeaks, smooth, cumsum, midiToHz } from './dsp.js';

export const BANDS = [
  { key: 'sub', label: 'sub', lo: 25, hi: 150 },
  { key: 'low', label: 'grave-medio', lo: 150, hi: 800 },
  { key: 'mid', label: 'medio', lo: 800, hi: 3000 },
  { key: 'high', label: 'agudo', lo: 3000, hi: 8000 },
  { key: 'air', label: 'aire', lo: 8000, hi: 17000 },
];
export const FPS = 100;
export const NOTE_FPS = 25;
export const NOTE_LO = 36, NOTE_HI = 96;   // C2 … C7
/** Bordes de las 24 bandas log de timbre (40 Hz … 15 kHz). */
export const TIMBRE_EDGES = Array.from({ length: 25 }, (_, i) => 40 * Math.pow(375, i / 24));

/**
 * @param {Float32Array} pcm  mono
 * @param {number} sr         frecuencia de muestreo
 * @param {(p:number, msg:string)=>void} progress
 */
export function analyze(pcm, sr, progress = () => {}) {
  const N = 2048, hop = Math.round(sr / FPS), fps = sr / hop;
  const nF = Math.max(4, Math.floor(pcm.length / hop));
  const spec = new Spectrum(N), half = N / 2, binHz = sr / N;
  const bin = (hz) => Math.max(1, Math.min(half - 2, Math.round(hz / binHz)));
  const bandBins = BANDS.map((b) => [bin(b.lo), Math.max(bin(b.lo) + 1, bin(b.hi))]);
  // 24 bandas log de timbre entre 40 Hz y 15 kHz
  const NT = 24, tEdges = TIMBRE_EDGES;
  const timbreBins = []; for (let i = 0; i < NT; i++) { const a = bin(tEdges[i]); timbreBins.push([a, Math.max(a + 1, bin(tEdges[i + 1]))]); }
  // clase de altura por bin (60 Hz – 4.2 kHz)
  const pc = new Int8Array(half).fill(-1);
  for (let k = 1; k < half; k++) { const f = k * binHz; if (f >= 60 && f <= 4200) pc[k] = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12; }

  const nB = BANDS.length;
  const flux = BANDS.map(() => new Float32Array(nF)), env = BANDS.map(() => new Float32Array(nF));
  const timbre = new Float32Array(nF * NT), chroma = new Float32Array(nF * 12), rms = new Float32Array(nF);
  const prevLog = new Float32Array(half), curLog = new Float32Array(half);

  // ---------- 1–2. STFT y características por cuadro ----------
  for (let t = 0; t < nF; t++) {
    const mag = spec.frame(pcm, t * hop);
    for (let k = 0; k < half; k++) curLog[k] = Math.log1p(20 * mag[k]);
    for (let b = 0; b < nB; b++) {
      const [a, e] = bandBins[b]; let f = 0, en = 0;
      for (let k = a; k < e; k++) {
        const prevMax = Math.max(prevLog[k - 1], prevLog[k], prevLog[k + 1]);
        const d = curLog[k] - prevMax; if (d > 0) f += d;
        en += mag[k];
      }
      flux[b][t] = f / (e - a); env[b][t] = Math.log1p(en * 4);
    }
    for (let i = 0; i < NT; i++) { const [a, e] = timbreBins[i]; let s = 0; for (let k = a; k < e; k++) s += mag[k]; timbre[t * NT + i] = Math.log1p(s * 4 / (e - a)); }
    for (let k = 1; k < half; k++) if (pc[k] >= 0) chroma[t * 12 + pc[k]] += mag[k] * mag[k];
    let e = 0; const c = t * hop; for (let i = 0; i < hop; i++) { const s = pcm[c + i] || 0; e += s * s; } rms[t] = Math.sqrt(e / hop);
    if (t > 0) prevLog.set(curLog); else prevLog.set(curLog);
    if ((t & 1023) === 0) progress(0.05 + (0.45 * t) / nF, 'espectro');
  }
  // normaliza croma por cuadro
  for (let t = 0; t < nF; t++) { let s = 0; for (let i = 0; i < 12; i++) s += chroma[t * 12 + i]; if (s > 0) for (let i = 0; i < 12; i++) chroma[t * 12 + i] /= s; }
  // envolventes normalizadas 0..1 (percentil 98)
  for (let b = 0; b < nB; b++) { const p = percentile(env[b], 0.98) || 1; const e = env[b]; for (let t = 0; t < nF; t++) e[t] = Math.min(1.2, e[t] / p); }
  const loud = (() => { const p = percentile(rms, 0.98) || 1; const l = new Float32Array(nF); for (let t = 0; t < nF; t++) l[t] = Math.min(1.2, rms[t] / p); return l; })();
  // timbre normalizado por banda (para rangos de Hz libres en los triggers); el crudo se usa para las secciones
  const timbreN = new Float32Array(nF * NT);
  for (let k = 0; k < NT; k++) { const col = new Float32Array(nF); for (let t = 0; t < nF; t++) col[t] = timbre[t * NT + k]; const p = percentile(col, 0.98) || 1; for (let t = 0; t < nF; t++) timbreN[t * NT + k] = Math.min(1.2, timbre[t * NT + k] / p); }

  // ---------- 3. onsets por banda ----------
  progress(0.52, 'onsets');
  const onsets = [];      // por banda: [{ t, s }]
  const odf = new Float32Array(nF);
  const bandWeight = [1.0, 0.9, 0.8, 0.6, 0.5];
  for (let b = 0; b < nB; b++) {
    const f = flux[b], p = percentile(f, 0.95) || 1e-6;
    const norm = new Float32Array(nF); for (let t = 0; t < nF; t++) norm[t] = f[t] / p;
    const peaks = pickPeaks(norm, { wMax: 3, wPre: 15, wPost: 3, k: 1.15, delta: 0.3, gap: 5 });
    const pS = percentile(Float32Array.from(peaks, (x) => x.s), 0.9) || 1;
    onsets.push(peaks.map((x) => ({ t: x.i / fps, s: Math.min(1, (x.s / pS) * 0.85) })));
    for (let t = 0; t < nF; t++) odf[t] += norm[t] * bandWeight[b];
  }
  // envolvente de onsets global, suavizada y normalizada
  const odfS = smooth(odf, 1.2);
  { const p = percentile(odfS, 0.97) || 1; for (let t = 0; t < nF; t++) odfS[t] = Math.min(1.5, odfS[t] / p); }

  // ---------- 4. tempo ----------
  progress(0.6, 'tempo');
  const tempo = estimateTempo(odfS, fps);
  const period = (60 / tempo.bpm) * fps;   // cuadros por beat

  // ---------- 5. beats y downbeats ----------
  progress(0.66, 'beats');
  const beatFrames = trackBeats(odfS, period, fps);
  const beats = Float32Array.from(beatFrames, (i) => i / fps);
  const nBeats = beats.length;
  // acento por beat: energía grave en la cercanía del beat + cambio de timbre/armonía respecto del beat anterior
  const beatFeat = beatFeatures(beatFrames, timbre, chroma, NT, nF);
  const accent = new Float32Array(nBeats);
  for (let i = 0; i < nBeats; i++) {
    const f = beatFrames[i]; let low = 0;
    for (let d = -2; d <= 2; d++) { const t = f + d; if (t >= 0 && t < nF) low += flux[0][t] + 0.6 * flux[1][t]; }
    const change = i > 0 ? 1 - cosine(beatFeat, i - 1, i, NT + 12) : 1;
    accent[i] = low + change * 1.5;
  }

  // ---------- 6. secciones ----------
  progress(0.74, 'secciones');
  // fase global del compás: la que acumula más acento en todo el tema
  const phaseScore = (b0, b1, ph) => { let v = 0, n = 0; for (let i = b0 + ((ph - b0) % 4 + 4) % 4; i < b1; i += 4) { v += accent[i]; n++; } return n ? v / n : 0; };
  let gPhase = 0, gBest = -1;
  for (let ph = 0; ph < 4; ph++) { const v = phaseScore(0, nBeats, ph); if (v > gBest) { gBest = v; gPhase = ph; } }
  const sections = findSections(beatFeat, nBeats, NT + 12, accent, gPhase);
  // dentro de cada sección la fase global se mantiene, salvo que otra sea claramente mejor (compases impares)
  const downbeat = new Uint8Array(nBeats);
  const barOf = new Int32Array(nBeats), beatInBar = new Uint8Array(nBeats);
  let bar = -1, phase = gPhase;
  for (const s of sections) {
    let best = phase, bestV = phaseScore(s.b0, s.b1, phase) * 1.35;
    for (let ph = 0; ph < 4; ph++) { const v = phaseScore(s.b0, s.b1, ph); if (v > bestV) { bestV = v; best = ph; } }
    phase = best; s.phase = best;
    for (let i = s.b0; i < s.b1; i++) {
      const k = ((i - phase) % 4 + 4) % 4;
      beatInBar[i] = k;
      if (k === 0) { downbeat[i] = 1; bar++; }
      barOf[i] = Math.max(0, bar);
    }
  }
  const sectionsOut = sections.map((s, i) => ({ t0: beats[s.b0], t1: s.b1 < nBeats ? beats[s.b1] : pcm.length / sr, b0: s.b0, b1: s.b1, type: s.type, energy: s.energy, index: i }));

  // ---------- 7. notas ----------
  progress(0.8, 'notas');
  const notesRes = transcribe(pcm, sr, progress);

  progress(1, 'listo');
  return {
    sr, fps, nFrames: nF, duration: pcm.length / sr,
    bpm: tempo.bpm, tempoConfidence: tempo.confidence, bpmCandidates: tempo.candidates,
    beats, downbeat, barOf, beatInBar, beatStrength: Float32Array.from(beatFrames, (f) => odfS[Math.min(nF - 1, f)]),
    bands: BANDS.map((b, i) => ({ key: b.key, label: b.label, env: env[i], flux: flux[i], onsets: onsets[i] })),
    odf: odfS, loud, chroma, timbre: timbreN,
    sections: sectionsOut,
    notes: notesRes.notes, noteFps: notesRes.fps, salience: notesRes.salience, melody: notesRes.melody,
  };
}

// ---------------------------------------------------------------- tempo
function estimateTempo(odf, fps) {
  const n = odf.length;
  // autocorrelación sobre lags 0.28 s … 1.6 s (37 … 214 bpm)
  const minLag = Math.round(0.28 * fps), maxLag = Math.round(1.6 * fps);
  const x = new Float32Array(n); const m = mean(odf); for (let i = 0; i < n; i++) x[i] = odf[i] - m;
  const ac = new Float32Array(maxLag * 4 + 2);
  const L = Math.min(n, 120 * fps);   // hasta 2 minutos alcanzan
  for (let lag = 1; lag < ac.length; lag++) { let s = 0; for (let i = 0; i + lag < L; i++) s += x[i] * x[i + lag]; ac[lag] = s / (L - lag); }
  const ac0 = ac[1] || 1;
  const r = (lag) => { // interpolación lineal en lags fraccionarios
    if (lag >= ac.length - 1) return 0; const i = Math.floor(lag), f = lag - i; return (ac[i] * (1 - f) + ac[i + 1] * f) / ac0;
  };
  const prior = (bpm) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 118) / 0.6, 2));   // preferencia suave alrededor de 118 bpm
  const cands = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    // repetición a 1, 2 y 4 compases (4/4): la métrica confirma el pulso
    const score = (r(lag) + 0.7 * r(lag * 4) + 0.5 * r(lag * 8) + 0.4 * r(lag * 16) + 0.3 * r(lag * 2)) * prior(bpm);
    cands.push({ lag, bpm, score });
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  // afina el lag con una parábola sobre la autocorrelación
  const l = best.lag, y0 = r(l - 1), y1 = r(l), y2 = r(l + 1);
  const den = y0 - 2 * y1 + y2, off = Math.abs(den) > 1e-9 ? 0.5 * (y0 - y2) / den : 0;
  const lagF = l + Math.max(-0.5, Math.min(0.5, off));
  const bpm = Math.round(((60 * fps) / lagF) * 10) / 10;
  const second = cands.find((c) => Math.abs(c.lag - l) > 3);
  return { bpm, confidence: second ? Math.min(1, (best.score - second.score) / Math.max(1e-6, best.score)) : 1, candidates: cands.slice(0, 5).map((c) => ({ bpm: Math.round(c.bpm * 10) / 10, score: c.score })) };
}
function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / Math.max(1, a.length); }

// ---------------------------------------------------------------- beats (Ellis 2007)
function trackBeats(odf, period, fps) {
  const n = odf.length, alpha = 40;
  const local = smooth(odf, period / 32 + 0.5);
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const pMin = Math.round(period * 0.5), pMax = Math.round(period * 2);
  for (let i = 0; i < n; i++) {
    let best = 0, bi = -1;
    for (let p = pMin; p <= pMax; p++) {
      const j = i - p; if (j < 0) break;
      const v = score[j] - alpha * Math.pow(Math.log(p / period), 2);
      if (v > best) { best = v; bi = j; }
    }
    score[i] = local[i] + best; back[i] = bi;
  }
  // arranca en el mejor puntaje del último período y vuelve
  let end = n - 1, bestV = -1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > bestV) { bestV = score[i]; end = i; }
  const out = []; for (let i = end; i >= 0; i = back[i]) { out.push(i); if (back[i] < 0) break; }
  out.reverse();
  // extiende hacia el inicio si quedaron beats sin cubrir (silencio inicial)
  while (out[0] - period >= 0 && out.length > 2) { const d = out[1] - out[0]; if (out[0] - d < 0) break; out.unshift(Math.round(out[0] - d)); }
  return out;
}

// ---------------------------------------------------------------- secciones
function beatFeatures(beatFrames, timbre, chroma, NT, nF) {
  const nB = beatFrames.length, D = NT + 12, F = new Float32Array(nB * D);
  for (let i = 0; i < nB; i++) {
    const a = beatFrames[i], b = i + 1 < nB ? beatFrames[i + 1] : Math.min(nF, a + (a - (beatFrames[i - 1] ?? a - 50)));
    const cnt = Math.max(1, b - a);
    for (let t = a; t < b && t < nF; t++) { for (let k = 0; k < NT; k++) F[i * D + k] += timbre[t * NT + k]; for (let k = 0; k < 12; k++) F[i * D + NT + k] += chroma[t * 12 + k] * 3; }
    for (let k = 0; k < D; k++) F[i * D + k] /= cnt;
  }
  // resta la media por dimensión y normaliza cada vector
  const mu = new Float32Array(D); for (let i = 0; i < nB; i++) for (let k = 0; k < D; k++) mu[k] += F[i * D + k] / nB;
  for (let i = 0; i < nB; i++) { let s = 0; for (let k = 0; k < D; k++) { F[i * D + k] -= mu[k]; s += F[i * D + k] ** 2; } s = Math.sqrt(s) || 1; for (let k = 0; k < D; k++) F[i * D + k] /= s; }
  return F;
}
function cosine(F, i, j, D) { let s = 0; for (let k = 0; k < D; k++) s += F[i * D + k] * F[j * D + k]; return s; }

function findSections(F, nB, D, accent, phase = 0) {
  if (nB < 16) return [{ b0: 0, b1: nB, type: 0, energy: 1, phase: 0 }];
  // novedad de Foote: kernel en tablero de 32 beats (8 compases) sobre la auto-similitud
  const W = 16;
  const nov = new Float32Array(nB);
  const kern = []; for (let a = -W; a < W; a++) for (let b = -W; b < W; b++) kern.push(Math.sign(a + 0.5) * Math.sign(b + 0.5) * Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (W / 2) ** 2)));
  for (let i = W; i < nB - W; i++) {
    let s = 0, k = 0;
    for (let a = -W; a < W; a++) for (let b = -W; b < W; b++, k++) s += kern[k] * cosine(F, i + a, i + b, D);
    nov[i] = s;
  }
  const p = percentile(nov, 0.99) || 1; for (let i = 0; i < nB; i++) nov[i] = Math.max(0, nov[i] / p);
  const peaks = pickPeaks(nov, { wMax: 8, wPre: 32, wPost: 32, k: 1.0, delta: 0.08, gap: 12 });
  // límites en downbeats (el más cercano al pico de novedad); el primero es el inicio del tema
  const snap = (b) => { const k = ((b - phase) % 4 + 4) % 4; return k < 2 ? b - k : b + (4 - k); };
  const bounds = [0];
  for (const pk of peaks) { const b = Math.min(nB, Math.max(0, snap(pk.i))); if (b - bounds[bounds.length - 1] >= 8 && nB - b >= 8) bounds.push(b); }
  bounds.push(nB);
  const secs = [];
  for (let i = 0; i < bounds.length - 1; i++) secs.push({ b0: bounds[i], b1: bounds[i + 1], type: -1, energy: 0, phase: 0 });
  // tipo: agrupa secciones parecidas (medias de sus huellas); misma letra = mismo color
  const means = secs.map((s) => { const m = new Float32Array(D); for (let i = s.b0; i < s.b1; i++) for (let k = 0; k < D; k++) m[k] += F[i * D + k]; let n = 0; for (let k = 0; k < D; k++) n += m[k] ** 2; n = Math.sqrt(n) || 1; for (let k = 0; k < D; k++) m[k] /= n; return m; });
  let types = 0;
  for (let i = 0; i < secs.length; i++) {
    let best = -1, bestSim = 0.78;
    for (let j = 0; j < i; j++) { let s = 0; for (let k = 0; k < D; k++) s += means[i][k] * means[j][k]; if (s > bestSim) { bestSim = s; best = j; } }
    secs[i].type = best >= 0 ? secs[best].type : types++;
    let e = 0; for (let b = s0(secs[i]); b < secs[i].b1; b++) e += accent[b]; secs[i].energy = e / Math.max(1, secs[i].b1 - secs[i].b0);
  }
  const maxE = Math.max(...secs.map((s) => s.energy)) || 1; for (const s of secs) s.energy /= maxE;
  return secs;
}
const s0 = (s) => s.b0;

// ---------------------------------------------------------------- notas
function transcribe(pcm, sr, progress) {
  const N = 8192, hop = Math.round(sr / NOTE_FPS), fps = sr / hop, nF = Math.max(2, Math.floor(pcm.length / hop));
  const spec = new Spectrum(N), binHz = sr / N, half = N / 2;
  const nP = NOTE_HI - NOTE_LO, sal = new Float32Array(nF * nP);
  // para cada semitono y armónico, el rango de bins (±¼ de tono)
  const ranges = [];
  for (let p = 0; p < nP; p++) {
    const f0 = midiToHz(NOTE_LO + p); const hs = [];
    for (let h = 1; h <= 6; h++) { const f = f0 * h; if (f * 1.03 > sr / 2) break; const a = Math.max(1, Math.floor((f / 1.0293) / binHz)), b = Math.min(half - 1, Math.ceil((f * 1.0293) / binHz)); hs.push([a, b, 1 / h]); }
    ranges.push(hs);
  }
  const logm = new Float32Array(half);
  for (let t = 0; t < nF; t++) {
    const mag = spec.frame(pcm, t * hop);
    for (let k = 0; k < half; k++) logm[k] = Math.log1p(30 * mag[k]);
    for (let p = 0; p < nP; p++) {
      let s = 0;
      for (const [a, b, w] of ranges[p]) { let m = 0; for (let k = a; k <= b; k++) if (logm[k] > m) m = logm[k]; s += m * w; }
      sal[t * nP + p] = s;
    }
    if ((t & 255) === 0) progress(0.8 + (0.18 * t) / nF, 'notas');
  }
  // resta la saliencia "de fondo" (armónicos de notas más graves): un pico de semitono tiene que superar a sus vecinos
  const salP = new Float32Array(sal.length);
  const gmax = percentile(sal, 0.995) || 1;
  for (let t = 0; t < nF; t++) for (let p = 0; p < nP; p++) {
    const v = sal[t * nP + p];
    const l = p > 0 ? sal[t * nP + p - 1] : 0, r = p < nP - 1 ? sal[t * nP + p + 1] : 0;
    if (v < l || v < r) continue;
    // si una octava abajo (o una quinta + octava) hay una nota más fuerte, esto es un armónico suyo
    const sub = p >= 12 ? sal[t * nP + p - 12] : 0, sub2 = p >= 19 ? sal[t * nP + p - 19] : 0;
    if (sub > v * 0.8 || sub2 > v * 0.9) continue;
    salP[t * nP + p] = Math.min(1, v / gmax);
  }
  // seguimiento de notas: una nota empieza cuando su saliencia sube por encima del umbral y termina cuando cae
  const notes = []; const active = new Map();
  const onTh = 0.5, offTh = 0.3, minLen = 3;
  const melody = new Float32Array(nF);
  for (let t = 0; t < nF; t++) {
    let bestP = -1, bestV = 0;
    for (let p = 0; p < nP; p++) {
      const v = salP[t * nP + p];
      if (v > bestV) { bestV = v; bestP = p; }
      const a = active.get(p);
      if (a) {
        if (v < offTh || t - a.t0 > fps * 8) { if (t - a.t0 >= minLen) notes.push({ t0: a.t0 / fps, t1: t / fps, midi: NOTE_LO + p, vel: Math.min(1, a.peak) }); active.delete(p); }
        else { a.peak = Math.max(a.peak, v); }
      } else if (v > onTh && (t === 0 || salP[(t - 1) * nP + p] < v * 0.7 || salP[Math.max(0, t - 2) * nP + p] < v * 0.5)) {
        if (active.size < 6) active.set(p, { t0: t, peak: v });
      }
    }
    melody[t] = bestV > onTh ? NOTE_LO + bestP : -1;
  }
  for (const [p, a] of active) if (nF - a.t0 >= minLen) notes.push({ t0: a.t0 / fps, t1: nF / fps, midi: NOTE_LO + p, vel: a.peak });
  notes.sort((a, b) => a.t0 - b.t0);
  return { notes, fps, salience: salP, melody };
}
