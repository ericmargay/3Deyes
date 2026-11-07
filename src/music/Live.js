/**
 * Analizador en vivo: la misma STFT y el mismo flujo por bandas que el
 * análisis offline, pero sobre el audio que llega (micrófono, línea desde
 * Ableton, o la pestaña de YouTube). No conoce el futuro: los onsets se
 * confirman con 3 cuadros de retraso (30 ms), el tempo se re-estima cada
 * segundo sobre los últimos 8 s y los beats se predicen a partir de la fase
 * que mejor alinea el pulso con la envolvente reciente.
 */
import { Spectrum, percentile, cumsum } from './dsp.js';
import { BANDS, FPS, TIMBRE_EDGES } from './analysis.js';
import { energyHz } from './Cues.js';

const HIST = 10;   // segundos de historia

export class LiveAnalyzer {
  constructor(ctx, stream, isTab = false) {
    this.ctx = ctx; this.sr = ctx.sampleRate;
    this.N = 2048; this.hop = Math.round(this.sr / FPS); this.fps = this.sr / this.hop;
    this.spec = new Spectrum(this.N);
    const half = this.N / 2, binHz = this.sr / this.N;
    const bin = (hz) => Math.max(1, Math.min(half - 2, Math.round(hz / binHz)));
    this.bandBins = BANDS.map((b) => [bin(b.lo), Math.max(bin(b.lo) + 1, bin(b.hi))]);
    this.pc = new Int8Array(half).fill(-1);
    for (let k = 1; k < half; k++) { const f = k * binHz; if (f >= 60 && f <= 4200) this.pc[k] = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12; }
    this.prevLog = new Float32Array(half); this.curLog = new Float32Array(half);
    this.timbreBins = []; for (let i = 0; i < 24; i++) { const a = bin(TIMBRE_EDGES[i]); this.timbreBins.push([a, Math.max(a + 1, bin(TIMBRE_EDGES[i + 1]))]); }
    this.timbreScale = new Float32Array(24).fill(1);
    // anillo de muestras
    this.ring = new Float32Array(this.sr * 4); this.w = 0; this.pending = 0; this.frames = 0;
    this.pcmWin = new Float32Array(this.N);
    // historia por cuadro
    const H = this.H = Math.round(HIST * this.fps);
    this.flux = BANDS.map(() => new Float32Array(H)); this.env = BANDS.map(() => new Float32Array(H));
    this.odf = new Float32Array(H); this.rms = new Float32Array(H); this.chromaH = new Float32Array(H * 12);
    this.timbre = new Float32Array(H * 24);
    this.head = 0; this.count = 0;
    this.fluxScale = BANDS.map(() => 0.05); this.envScale = BANDS.map(() => 1); this.rmsScale = 0.1;
    this.onsets = BANDS.map(() => []);    // [{ t, s }] confirmados (tiempo en reloj del ctx)
    this.lastConfirmed = -1;
    this.bpm = 0; this.period = 0; this.nextBeat = 0; this.beatIndex = 0; this.phaseScore = new Float32Array(4); this.tempoAt = 0;
    this.pendingBeats = [];
    this.onSection = false; this.sectionT = 0;
    this.sectionIndex = 0; this.frameTime = 0;

    this.src = ctx.createMediaStreamSource(stream);
    this.proc = ctx.createScriptProcessor(1024, 1, 1);
    this.proc.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) { this.ring[this.w] = d[i]; this.w = (this.w + 1) % this.ring.length; } this.pending += d.length; this.lastAudioT = ctx.currentTime; };
    this.src.connect(this.proc); this.proc.connect(ctx.destination);   // el processor necesita salida; sin ganancia audible
    this.sink = ctx.createGain(); this.sink.gain.value = 0;
    this.proc.disconnect(); this.proc.connect(this.sink); this.sink.connect(ctx.destination);
    this.stream = stream; this.isTab = isTab;
  }

  dispose() { try { this.proc.disconnect(); this.src.disconnect(); this.sink.disconnect(); } catch (_) { /* */ } this.stream.getTracks().forEach((t) => t.stop()); }

  /** Procesa los hops acumulados desde el último cuadro de video. */
  update() {
    while (this.pending >= this.hop) { this.pending -= this.hop; this.step(); }
  }

  step() {
    const { N, ring, half } = { N: this.N, ring: this.ring, half: this.N / 2 };
    // ventana: las últimas N muestras hasta (w - pending)
    const end = (this.w - this.pending + ring.length) % ring.length;
    for (let i = 0; i < N; i++) this.pcmWin[i] = ring[(end - N + i + ring.length) % ring.length];
    const mag = this.spec.frame(this.pcmWin, half);
    const t = this.ctx.currentTime - (this.pending + N / 2) / this.sr;   // instante del centro de la ventana
    this.frameTime = t;
    const h = this.head, cur = this.curLog, prev = this.prevLog;
    for (let k = 0; k < half; k++) cur[k] = Math.log1p(20 * mag[k]);
    let odf = 0;
    const bw = [1, 0.9, 0.8, 0.6, 0.5];
    for (let b = 0; b < BANDS.length; b++) {
      const [a, e] = this.bandBins[b]; let f = 0, en = 0;
      for (let k = a; k < e; k++) { const d = cur[k] - Math.max(prev[k - 1], prev[k], prev[k + 1]); if (d > 0) f += d; en += mag[k]; }
      f /= (e - a);
      // escalas adaptativas (se acercan al percentil alto con lentitud)
      this.fluxScale[b] = Math.max(this.fluxScale[b] * 0.9995, f * 0.7, 1e-4);
      const envv = Math.log1p(en * 4); this.envScale[b] = Math.max(this.envScale[b] * 0.9995, envv, 1e-3);
      this.flux[b][h] = f / this.fluxScale[b]; this.env[b][h] = Math.min(1.2, envv / this.envScale[b]);
      odf += this.flux[b][h] * bw[b];
    }
    this.odf[h] = odf / 3.8;
    for (let i = 0; i < 24; i++) { const [a, e] = this.timbreBins[i]; let sm = 0; for (let k = a; k < e; k++) sm += mag[k]; const v = Math.log1p((sm * 4) / (e - a)); this.timbreScale[i] = Math.max(this.timbreScale[i] * 0.9995, v, 1e-3); this.timbre[h * 24 + i] = Math.min(1.2, v / this.timbreScale[i]); }
    let e2 = 0; for (let i = N - this.hop; i < N; i++) e2 += this.pcmWin[i] ** 2; const r = Math.sqrt(e2 / this.hop);
    this.rmsScale = Math.max(this.rmsScale * 0.9995, r, 1e-4); this.rms[h] = Math.min(1.2, r / this.rmsScale);
    let cs = 0; const cr = this.chromaH.subarray(h * 12, h * 12 + 12); cr.fill(0);
    for (let k = 1; k < half; k++) if (this.pc[k] >= 0) cr[this.pc[k]] += mag[k] * mag[k];
    for (let i = 0; i < 12; i++) cs += cr[i]; if (cs > 0) for (let i = 0; i < 12; i++) cr[i] /= cs;
    prev.set(cur);
    this.head = (h + 1) % this.H; this.count++; this.frames++;
    this.confirmOnsets(t);
    if (this.count > this.fps * 4 && this.frames % Math.round(this.fps) === 0) this.estimateTempo(t);
  }

  at(arr, back) { return arr[(this.head - 1 - back + this.H * 2) % this.H]; }

  /** Un onset se confirma 3 cuadros después (pico local con umbral adaptativo). */
  confirmOnsets(tNow) {
    const D = 3; if (this.count < 20) return;
    const fpsDt = 1 / this.fps;
    for (let b = 0; b < BANDS.length; b++) {
      const f = this.flux[b], v = this.at(f, D);
      let isMax = true; for (let d = 0; d <= 2 * D; d++) if (this.at(f, d) > v) { isMax = false; break; }
      if (!isMax) continue;
      let m = 0; for (let d = D + 1; d <= D + 15; d++) m += this.at(f, d); m /= 15;
      if (v < m * 1.15 + 0.3) continue;
      const t = tNow - D * fpsDt, last = this.onsets[b][this.onsets[b].length - 1];
      if (last && t - last.t < 5 * fpsDt) continue;
      this.onsets[b].push({ t, s: Math.min(1, (v - m) * 0.5) });
      if (this.onsets[b].length > 64) this.onsets[b].shift();
    }
  }

  estimateTempo(tNow) {
    const n = Math.min(this.count, this.H), x = new Float32Array(n);
    let m = 0; for (let i = 0; i < n; i++) { x[i] = this.at(this.odf, n - 1 - i); m += x[i]; } m /= n;
    for (let i = 0; i < n; i++) x[i] -= m;
    const minLag = Math.round(0.28 * this.fps), maxLag = Math.round(1.6 * this.fps);
    const ac = new Float32Array(maxLag * 4 + 2);
    for (let lag = 1; lag < ac.length && lag < n; lag++) { let s = 0; for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag]; ac[lag] = s / (n - lag); }
    const r = (l) => (l < ac.length - 1 ? (ac[Math.floor(l)] * (1 - (l % 1)) + ac[Math.floor(l) + 1] * (l % 1)) / (ac[1] || 1) : 0);
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * this.fps) / lag, prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 118) / 0.6, 2));
      const sc = (r(lag) + 0.7 * r(lag * 4) + 0.5 * r(lag * 8) + 0.3 * r(lag * 2)) * prior;
      if (sc > best) { best = sc; bestLag = lag; }
    }
    if (!bestLag) return;
    // afina con parábola
    const y0 = r(bestLag - 1), y1 = r(bestLag), y2 = r(bestLag + 1), den = y0 - 2 * y1 + y2;
    const lag = bestLag + (Math.abs(den) > 1e-9 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0);
    const newBpm = (60 * this.fps) / lag;
    // si cambia poco, suaviza; si cambia mucho (otro tema), salta
    this.bpm = this.bpm && Math.abs(newBpm - this.bpm) < 4 ? this.bpm * 0.7 + newBpm * 0.3 : newBpm;
    this.period = 60 / this.bpm;
    // fase: desplazamiento (0..período) que maximiza la envolvente en los últimos 6 s
    const per = this.period * this.fps, steps = 24; let bestPh = 0, bestV = -1;
    const span = Math.min(n, Math.round(6 * this.fps));
    for (let s = 0; s < steps; s++) {
      const ph = (s / steps) * per; let v = 0, c = 0;
      for (let k = ph; k < span; k += per) { v += this.at(this.odf, Math.round(k)); c++; }
      v /= Math.max(1, c); if (v > bestV) { bestV = v; bestPh = ph; }
    }
    // el último beat cayó hace bestPh cuadros; el próximo es ese + período
    const lastBeatT = tNow - bestPh / this.fps;
    let next = lastBeatT + this.period;
    // mantiene la continuidad si la nueva predicción está cerca de la anterior
    if (this.nextBeat && Math.abs(next - this.nextBeat) < this.period * 0.25) next = this.nextBeat * 0.6 + next * 0.4;
    while (next < tNow) next += this.period;
    this.nextBeat = next;
    this.tempoAt = tNow;
    // downbeat: fase de 4 beats con más grave en los últimos 8 compases
    const lowF = this.flux[0]; const acc = [0, 0, 0, 0];
    for (let k = 0; k < 32; k++) { const back = Math.round(bestPh + k * per); if (back >= n) break; let v = 0; for (let d = -2; d <= 2; d++) v += this.at(lowF, Math.max(0, back + d)); acc[k % 4] += v; }
    let bp = 0; for (let i = 1; i < 4; i++) if (acc[i] > acc[bp]) bp = i;
    this.downPhase = bp;   // el último beat (k=0) tiene fase bp → el próximo tiene (bp + 3) % 4 … contado hacia atrás
    // cambio de sección: timbre medio de los últimos 2 compases vs los 2 anteriores
    const half8 = Math.round(8 * per); if (n > half8 * 2) {
      let a = 0, b = 0; for (let k = 0; k < half8; k++) { a += this.at(this.rms, k); b += this.at(this.rms, k + half8); }
      const d = Math.abs(a - b) / Math.max(1e-3, a + b);
      if (d > 0.25 && tNow - this.sectionT > 8 * this.period) { this.sectionT = tNow; this.sectionIndex++; this.onSection = true; }
    }
  }
}

/** Misma interfaz que MusicCues, alimentada por el analizador en vivo. */
export class LiveCues {
  constructor(live) {
    this.L = live; this.live = true; this.duration = 0;
    this.bands = BANDS.map((b, i) => ({ key: b.key, label: b.label, env: 0, flux: 0, hit: 0, pulse: 0, untilNext: 1e9, nextStrength: 0, sinceLast: 1e9, lastStrength: 0, _seen: 0 }));
    this.chroma = new Float32Array(12); this.timbre = new Float32Array(24); this.notesOn = []; this.notesActive = []; this.melody = -1;
    this.sections = [{ t0: 0, t1: 1e9, type: 0, energy: 0.5, index: 0 }]; this.section = this.sections[0]; this.sectionIndex = 0; this.sectionPhase = 0; this.energy = 0.5;
    this.t = 0; this.beat = 0; this.bar = 0; this.beatInBar = 0; this.beatPhase = 0; this.barPhase = 0; this.bpm = 0; this.beatDur = 0.6; this.beatStrength = 0.6;
    this.lastBeatT = 0; this.onBeat = false; this.onDownbeat = false; this.onSection = false;
  }
  reset() {}
  /** Reloj MIDI de Ableton (si llega): tempo y fase exactos; el audio sigue aportando los golpes. */
  setClock(clock) { this.clock = clock; }
  setTime(t, dt) {
    const L = this.L; this.t = t; this.dt = dt;
    this.onBeat = false; this.onDownbeat = false;
    const ck = this.clock;
    if (ck?.running && ck.alive && ck.bpm > 0) {
      this.bpm = ck.bpm; this.beatDur = 60 / ck.bpm;
      const pos = ck.position(), bi = Math.floor(pos);
      if (this._ckBeat === undefined) this._ckBeat = bi;
      if (bi !== this._ckBeat) { this.onBeat = bi > this._ckBeat; this._ckBeat = bi; this.beat = bi; this.beatInBar = ((bi % 4) + 4) % 4; this.bar = Math.floor(bi / 4); this.onDownbeat = this.onBeat && this.beatInBar === 0; this.lastBeatT = t; }
      this.beatPhase = pos - bi; this.barPhase = (this.beatInBar + this.beatPhase) / 4;
      L.nextBeat = t + (1 - this.beatPhase) * this.beatDur;
      this.fillBands(t, dt);
      return;
    }
    this.bpm = L.bpm || 0; this.beatDur = L.period || 0.6;
    if (L.nextBeat && t >= L.nextBeat) {
      this.onBeat = true; this.lastBeatT = L.nextBeat; this.beat++;
      L.nextBeat += L.period;
      this.beatInBar = (this.beatInBar + 1) % 4;
      // re-sincroniza la fase del compás con la acentuación grave detectada
      if (L.downPhase !== undefined && this.beat % 16 === 0) this.beatInBar = 0;
      if (this.beatInBar === 0) { this.bar++; this.onDownbeat = true; }
    }
    this.beatPhase = this.beatDur > 0 ? Math.min(1, Math.max(0, (t - this.lastBeatT) / this.beatDur)) : 0;
    this.barPhase = (this.beatInBar + this.beatPhase) / 4;
    this.fillBands(t, dt);
  }
  fillBands(t, dt) {
    const L = this.L;
    this.onSection = L.onSection; L.onSection = false;
    if (this.onSection) { this.sectionIndex = L.sectionIndex; this.section = { t0: t, t1: 1e9, type: this.sectionIndex % 4, energy: 0.5, index: this.sectionIndex }; }
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i], on = L.onsets[i];
      b.env = L.count ? L.at(L.env[i], 0) : 0; b.flux = L.count ? L.at(L.flux[i], 0) : 0;
      b.hit = 0;
      while (b._seen < on.length) { const o = on[b._seen++]; if (o.t > t - 0.5) { b.hit = Math.max(b.hit, o.s); b.lastStrength = o.s; b._lastT = o.t; } }
      if (on.length < b._seen) b._seen = on.length;   // el buffer se recortó
      if (b.hit > 0) b.pulse = Math.max(b.pulse, b.hit); else b.pulse *= Math.exp(-dt * 9);
      b.sinceLast = b._lastT !== undefined ? t - b._lastT : 1e9; b.untilNext = 1e9; b.nextStrength = 0;
    }
    this.loud = L.count ? L.at(L.rms, 0) : 0;
    if (L.count) { const h = (L.head - 1 + L.H) % L.H; for (let i = 0; i < 12; i++) this.chroma[i] = L.chromaH[h * 12 + i]; for (let i = 0; i < 24; i++) this.timbre[i] = L.timbre[h * 24 + i]; }
    let mx = 0, mi = -1; for (let i = 0; i < 12; i++) if (this.chroma[i] > mx) { mx = this.chroma[i]; mi = i; }
    this.melody = mx > 0.25 ? 60 + mi : -1;
    this.energy = Math.min(1, this.loud);
  }
  energyHz(lo, hi) { return energyHz(this.timbre, lo, hi); }
  upcoming() { return []; }
  beatsAhead(lookahead) { return this.beatsBetween(this.t, this.t + lookahead); }
  /** Beats pasados (los que cayeron) y futuros (predichos a partir del último). */
  beatsBetween(t0, t1) {
    const out = []; if (!this.beatDur) return out;
    const i0 = Math.ceil(this.beat + (t0 - this.lastBeatT) / this.beatDur), i1 = Math.floor(this.beat + (t1 - this.lastBeatT) / this.beatDur);
    for (let i = i0; i <= i1; i++) { const t = this.beatTime(i); if (t < t0 || t >= t1) continue; const bib = ((this.beatInBar + (i - this.beat)) % 4 + 4) % 4; out.push({ t, downbeat: bib === 0, index: i, strength: 0.6, bar: this.bar + Math.floor((i - this.beat + this.beatInBar) / 4), beatInBar: bib }); }
    return out;
  }
  onsetsBetween(band, t0, t1) { return this.L.onsets[band].filter((o) => o.t >= t0 && o.t < t1); }
  notesAhead() { return []; }
  notesBetween() { return []; }
  sectionAt() { return this.section; }
  beatTime(i) { return this.lastBeatT + (i - this.beat) * this.beatDur; }
}
