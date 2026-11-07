/**
 * Cues: lo que una escena pregunta en cada cuadro sobre la música.
 *
 * Se construye con el análisis de un tema (MusicCues) o con el analizador en
 * vivo (LiveCues, misma interfaz, sin futuro). La escena llama setTime(t, dt)
 * una vez por cuadro y lee:
 *
 *   t, dt, bpm, beatDur
 *   beat, beatPhase (0..1 dentro del beat), beatInBar, bar, barPhase (0..1 en el compás)
 *   onBeat / onDownbeat   true solo en el cuadro en que cae
 *   beatStrength          fuerza del último beat (0..1.5)
 *   section, sectionIndex, sectionPhase, onSection, sections[]
 *   bands[i]: env (0..1), hit (fuerza del onset caído en este cuadro, 0 si no),
 *             pulse (decae desde el último hit), untilNext (s), nextStrength, sinceLast
 *   loud (0..1), chroma[12], melody (midi o -1)
 *   notesOn (notas que empiezan en este cuadro), notesActive
 *   upcoming(band, lookahead) → onsets entre t y t+lookahead (los que vienen)
 *   beatsAhead(lookahead), notesAhead(lookahead)
 */
import { BANDS, TIMBRE_EDGES } from './analysis.js';

const CENTERS = Array.from({ length: 24 }, (_, i) => Math.sqrt(TIMBRE_EDGES[i] * TIMBRE_EDGES[i + 1]));
export function energyHz(timbre, lo, hi) { let s = 0, n = 0; for (let i = 0; i < 24; i++) if (CENTERS[i] >= lo && CENTERS[i] <= hi) { s += timbre[i]; n++; } return n ? Math.min(1, s / n) : 0; }

const lowerBound = (arr, x, key = (v) => v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) < x) lo = m + 1; else hi = m; } return lo; };

export class MusicCues {
  constructor(A) {
    this.A = A;
    this.bpm = A.bpm; this.beatDur = 60 / A.bpm;
    this.duration = A.duration;
    this.sections = A.sections;
    this.bands = A.bands.map((b) => ({ key: b.key, label: b.label, env: 0, flux: 0, hit: 0, pulse: 0, untilNext: 1e9, nextStrength: 0, sinceLast: 1e9, lastStrength: 0, _i: 0, _onsets: b.onsets }));
    this.chroma = new Float32Array(12); this.timbre = new Float32Array(24);
    this.notesOn = []; this.notesActive = [];
    this._noteI = 0; this._beatI = 0; this._active = new Set();
    this.reset(0);
    this.live = false;
  }

  reset(t) {
    const A = this.A;
    this.t = t; this.tPrev = t;
    this._beatI = lowerBound(A.beats, t) - 1;
    for (const b of this.bands) { b._i = lowerBound(b._onsets, t, (o) => o.t); b.pulse = 0; b.hit = 0; }
    this._noteI = lowerBound(A.notes, t, (n) => n.t0);
    this._active.clear();
    for (let i = 0; i < this._noteI; i++) { const n = A.notes[i]; if (n.t1 > t) this._active.add(n); }
    this.onBeat = false; this.onDownbeat = false; this.onSection = false;
    this.sectionIndex = -1;
    this.setTime(t, 0);
  }

  setTime(t, dt) {
    const A = this.A;
    if (t < this.t - 0.05 || t > this.t + 1.5) { this.reset(t); return; }
    this.tPrev = this.t; this.t = t; this.dt = dt;
    const fr = Math.max(0, Math.min(A.nFrames - 1, t * A.fps)), f0 = Math.floor(fr), f1 = Math.min(A.nFrames - 1, f0 + 1), k = fr - f0;
    const lerp = (arr) => arr[f0] * (1 - k) + arr[f1] * k;

    // beats
    this.onBeat = false; this.onDownbeat = false;
    while (this._beatI + 1 < A.beats.length && A.beats[this._beatI + 1] <= t) { this._beatI++; this.onBeat = true; if (A.downbeat[this._beatI]) this.onDownbeat = true; }
    const bi = this._beatI;
    const bt = bi >= 0 ? A.beats[bi] : 0, nt = bi + 1 < A.beats.length ? A.beats[bi + 1] : bt + this.beatDur;
    this.beat = bi; this.beatT = bt; this.nextBeatT = nt;
    this.beatPhase = Math.min(1, Math.max(0, (t - bt) / Math.max(1e-3, nt - bt)));
    this.beatInBar = bi >= 0 ? A.beatInBar[bi] : 0;
    this.bar = bi >= 0 ? A.barOf[bi] : 0;
    this.barPhase = (this.beatInBar + this.beatPhase) / 4;
    this.beatStrength = bi >= 0 ? A.beatStrength[bi] : 0;

    // sección
    let si = this.sectionIndex;
    if (si < 0 || t < A.sections[si].t0 || t >= A.sections[si].t1) {
      si = Math.max(0, lowerBound(A.sections, t, (s) => s.t0) - 1);
      while (si + 1 < A.sections.length && A.sections[si + 1].t0 <= t) si++;
    }
    this.onSection = si !== this.sectionIndex && this.sectionIndex >= 0;
    this.sectionIndex = si; this.section = A.sections[si];
    this.sectionPhase = this.section ? Math.min(1, (t - this.section.t0) / Math.max(1e-3, this.section.t1 - this.section.t0)) : 0;
    this.energy = this.section?.energy ?? 0.5;

    // bandas
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i], src = A.bands[i], on = b._onsets;
      b.env = lerp(src.env); b.flux = src.flux[f0];
      b.hit = 0;
      while (b._i < on.length && on[b._i].t <= t) { b.hit = Math.max(b.hit, on[b._i].s); b.lastStrength = on[b._i].s; b._lastT = on[b._i].t; b._i++; }
      if (b.hit > 0) b.pulse = Math.max(b.pulse, b.hit); else b.pulse *= Math.exp(-dt * 9);
      b.sinceLast = b._lastT !== undefined ? t - b._lastT : 1e9;
      const nx = on[b._i]; b.untilNext = nx ? nx.t - t : 1e9; b.nextStrength = nx ? nx.s : 0;
    }
    this.loud = lerp(A.loud);
    for (let i = 0; i < 12; i++) this.chroma[i] = A.chroma[f0 * 12 + i] * (1 - k) + A.chroma[f1 * 12 + i] * k;
    if (A.timbre) for (let i = 0; i < 24; i++) this.timbre[i] = A.timbre[f0 * 24 + i] * (1 - k) + A.timbre[f1 * 24 + i] * k;
    const mf = Math.min(A.melody.length - 1, Math.floor(t * A.noteFps)); this.melody = A.melody[mf];

    // notas
    this.notesOn.length = 0;
    while (this._noteI < A.notes.length && A.notes[this._noteI].t0 <= t) { const n = A.notes[this._noteI++]; this.notesOn.push(n); this._active.add(n); }
    for (const n of this._active) if (n.t1 <= t) this._active.delete(n);
    this.notesActive = [...this._active];
  }

  energyHz(lo, hi) { return energyHz(this.timbre, lo, hi); }
  /** Onsets de una banda entre t0 y t1 (índices [a, b) sobre bands[i]._onsets). */
  onsetsBetween(band, t0, t1) { const on = this.bands[band]._onsets; const a = lowerBound(on, t0, (o) => o.t), b = lowerBound(on, t1, (o) => o.t); return on.slice(a, b); }
  beatsBetween(t0, t1) { const A = this.A, out = [], a = lowerBound(A.beats, t0), b = lowerBound(A.beats, t1); for (let i = a; i < b; i++) out.push({ t: A.beats[i], downbeat: !!A.downbeat[i], index: i, strength: A.beatStrength[i], bar: A.barOf[i], beatInBar: A.beatInBar[i] }); return out; }
  notesBetween(t0, t1) { const A = this.A, out = []; const a = lowerBound(A.notes, t0 - 12, (n) => n.t0); for (let i = a; i < A.notes.length && A.notes[i].t0 < t1; i++) if (A.notes[i].t1 > t0) out.push(A.notes[i]); return out; }
  sectionAt(t) { const A = this.A; let i = Math.max(0, lowerBound(A.sections, t, (s) => s.t0) - 1); while (i + 1 < A.sections.length && A.sections[i + 1].t0 <= t) i++; return A.sections[i]; }
  /** Onsets de una banda entre t y t+lookahead. */
  upcoming(band, lookahead) { const b = this.bands[band], on = b._onsets, out = []; for (let i = b._i; i < on.length && on[i].t <= this.t + lookahead; i++) out.push(on[i]); return out; }
  beatsAhead(lookahead) { const A = this.A, out = []; for (let i = this._beatI + 1; i < A.beats.length && A.beats[i] <= this.t + lookahead; i++) out.push({ t: A.beats[i], downbeat: !!A.downbeat[i], index: i, strength: A.beatStrength[i] }); return out; }
  notesAhead(lookahead) { const A = this.A, out = []; for (let i = this._noteI; i < A.notes.length && A.notes[i].t0 <= this.t + lookahead; i++) out.push(A.notes[i]); return out; }
  /** Tiempo del beat número i (puede ser futuro). */
  beatTime(i) { const A = this.A; return i < A.beats.length ? A.beats[i] : A.beats[A.beats.length - 1] + (i - A.beats.length + 1) * this.beatDur; }
}

/**
 * Cues sin música: un reloj interno a `bpm` para que las escenas respiren
 * solas (o reciban el beat por MIDI / tap). Misma interfaz, sin eventos de bandas.
 */
export class IdleCues {
  constructor(bpm = 100) {
    this.live = true; this.bpm = bpm; this.beatDur = 60 / bpm; this.duration = 0;
    this.t = 0; this.dt = 0; this.beat = 0; this.bar = 0; this.beatInBar = 0; this.beatPhase = 0; this.barPhase = 0;
    this.bands = BANDS.map((b) => ({ key: b.key, label: b.label, env: 0, flux: 0, hit: 0, pulse: 0, untilNext: 1e9, nextStrength: 0, sinceLast: 1e9, lastStrength: 0 }));
    this.sections = [{ t0: 0, t1: 1e9, type: 0, energy: 0.5, index: 0 }]; this.section = this.sections[0]; this.sectionIndex = 0; this.sectionPhase = 0; this.energy = 0.5;
    this.chroma = new Float32Array(12); this.timbre = new Float32Array(24); this.loud = 0; this.melody = -1; this.notesOn = []; this.notesActive = [];
    this.beatStrength = 0.6;
  }
  energyHz() { return 0; }
  setBpm(bpm) { this.bpm = bpm; this.beatDur = 60 / bpm; }
  setTime(t, dt) {
    this.dt = dt; this.t += dt;
    const prev = this.beat;
    this.beatPhase += dt / this.beatDur;
    this.onBeat = false; this.onDownbeat = false; this.onSection = false;
    if (this.beatPhase >= 1) { this.beatPhase -= Math.floor(this.beatPhase); this.beat++; this.beatInBar = this.beat % 4; if (this.beatInBar === 0) { this.bar++; this.onDownbeat = true; } this.onBeat = true; }
    this.barPhase = (this.beatInBar + this.beatPhase) / 4;
    for (const b of this.bands) { b.hit = 0; b.pulse *= Math.exp(-dt * 9); }
    void prev;
  }
  tap() { this.beatPhase = 0; this.beat++; this.beatInBar = this.beat % 4; this.onBeat = true; }
  upcoming() { return []; }
  beatsAhead(lookahead) { return this.beatsBetween(this.t, this.t + lookahead); }
  beatsBetween(t0, t1) { const out = []; const i0 = Math.ceil(this.beat + this.beatPhase + (t0 - this.t) / this.beatDur); for (let i = i0; this.beatTime(i) < t1; i++) { if (this.beatTime(i) < t0) continue; out.push({ t: this.beatTime(i), downbeat: i % 4 === 0, index: i, strength: 0.6, bar: Math.floor(i / 4), beatInBar: ((i % 4) + 4) % 4 }); } return out; }
  onsetsBetween() { return []; }
  notesAhead() { return []; }
  notesBetween() { return []; }
  sectionAt() { return this.section; }
  beatTime(i) { return this.t + (i - this.beat - this.beatPhase) * this.beatDur; }
}
