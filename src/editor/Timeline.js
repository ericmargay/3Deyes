import { findByPath, setProp, getProp } from './Project.js';

/**
 * Reproductor de línea de tiempo. Evalúa pistas de keyframes y dispara cues.
 *  - pista "param:<id>"                   → params.set(id, valor, 'timeline')
 *  - pista "obj:<ruta>:<propiedad>"       → setProp(objeto, propiedad, valor)
 *  - cue { t, action }                    → rules.run(action)
 */
export const EASES = {
  linear: (k) => k,
  smooth: (k) => k * k * (3 - 2 * k),
  easeIn: (k) => k * k,
  easeOut: (k) => 1 - (1 - k) * (1 - k),
  step: (k) => (k >= 1 ? 1 : 0),
};
export const EASE_NAMES = Object.keys(EASES);

export function evalKeys(keys, t) {
  if (!keys.length) return undefined;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  if (typeof a.v !== 'number' || typeof b.v !== 'number') return a.v;
  const span = b.t - a.t;
  const k = span > 0 ? (t - a.t) / span : 1;
  const e = EASES[a.e] || EASES.linear;
  return a.v + (b.v - a.v) * e(k);
}

export class TimelinePlayer {
  constructor(params, opts = {}) {
    this.params = params;
    this.getRoot = opts.getRoot || (() => null);     // raíz de la escena para "obj:" 
    this.runAction = opts.runAction || (() => {});    // ejecuta cues
    this.clip = null;
    this.time = 0;
    this.playing = false;
    this.onChange = opts.onChange || (() => {});
  }

  load(clip, autoplay = true) {
    this.clip = clip;
    this.time = 0;
    this.playing = !!(autoplay && clip && clip.autoplay && (clip.tracks.length || clip.cues.length));
    this.apply();
  }

  get duration() { return this.clip?.duration ?? 60; }
  play() { this.playing = true; }
  pause() { this.playing = false; }
  toggle() { this.playing = !this.playing; }
  stop() { this.playing = false; this.seek(0); }
  seek(t) { this.time = Math.max(0, Math.min(this.duration, t)); this.apply(); this.onChange(); }

  update(dt) {
    if (!this.clip || !this.playing) return;
    const prev = this.time;
    let t = prev + dt;
    const D = this.duration;
    if (t >= D) {
      this.fireCues(prev, D + 1e-6);
      if (this.clip.loop) { t -= D; this.fireCues(-1e-6, t); } else { t = D; this.playing = false; }
    } else this.fireCues(prev, t);
    this.time = t;
    this.apply();
    this.onChange();
  }

  fireCues(from, to) {
    for (const c of this.clip?.cues || []) if (c.t > from && c.t <= to) this.runAction(c.action, { cue: c });
  }

  apply() {
    if (!this.clip) return;
    for (const track of this.clip.tracks) {
      if (track.muted || !track.keys?.length) continue;
      const v = evalKeys(track.keys, this.time);
      if (v === undefined) continue;
      this.applyTarget(track.target, v);
    }
  }

  applyTarget(target, v) {
    if (target.startsWith('param:')) { this.params.set(target.slice(6), v, 'timeline'); return; }
    if (target.startsWith('obj:')) {
      const i = target.lastIndexOf(':');
      const path = target.slice(4, i), prop = target.slice(i + 1);
      const obj = findByPath(this.getRoot(), path);
      if (obj) setProp(obj, prop, v);
    }
  }

  /** Valor actual del destino (para grabar keyframes). */
  readTarget(target) {
    if (target.startsWith('param:')) return this.params.get(target.slice(6));
    if (target.startsWith('obj:')) {
      const i = target.lastIndexOf(':');
      const obj = findByPath(this.getRoot(), target.slice(4, i));
      return obj ? getProp(obj, target.slice(i + 1)) : undefined;
    }
    return undefined;
  }

  /** Agrega o reemplaza un keyframe en el tiempo actual (o t). */
  setKey(target, v, t = this.time, e = 'smooth') {
    if (!this.clip) return null;
    let track = this.clip.tracks.find((x) => x.target === target);
    if (!track) { track = { target, keys: [] }; this.clip.tracks.push(track); }
    const eps = 1e-3;
    let key = track.keys.find((k) => Math.abs(k.t - t) < eps);
    if (key) { key.v = v; } else { key = { t, v, e }; track.keys.push(key); track.keys.sort((a, b) => a.t - b.t); }
    return key;
  }
}
