import { TIMBRE_EDGES } from './analysis.js';

/**
 * Disparadores de audio ("Audio Trigger", sin keyframes): cada uno convierte
 * una característica de la música en un valor 0..1 con ataque y liberación,
 * como los seguidores de envolvente de un addon de Blender / TouchDesigner.
 *
 *   fuente      banda (sub … aire) · hz (rango libre) · golpe (onset de una
 *               banda) · beat · compás · nota · sección · sonoridad
 *   umbral      por debajo no pasa nada (golpes: fuerza mínima)
 *   ataque /    ms de subida y de bajada del valor
 *   liberación
 *   cada / desfase   beat: dispara cada N beats, corrido `desfase` beats
 *   prob        probabilidad de que un evento dispare (azar controlado)
 *   mínimo      s entre disparos
 *
 * Los triggers con nombre (TriggerBank) publican `trig:<nombre>` en el bus:
 * cualquier parámetro de cualquier escena se puede asignar con learn.
 */
export const TRIGGER_SOURCES = ['banda', 'hz', 'golpe', 'beat', 'compás', 'nota', 'sección', 'sonoridad'];
export const BAND_NAMES = ['sub', 'grave', 'medio', 'agudo', 'aire'];

export class Trigger {
  constructor(def = {}) {
    this.def = { fuente: 'banda', banda: 0, lo: 40, hi: 400, umbral: 0.2, ataque: 10, liberacion: 200, cada: 1, desfase: 0, prob: 1, minimo: 0, ...def };
    this.env = 0; this.raw = 0; this.lastFire = -1e9; this.fired = false;
  }

  /** Valor crudo 0..1 de la fuente en este cuadro (impulso 1 para eventos). */
  sample(c) {
    const d = this.def, thr = d.umbral;
    const above = (v) => Math.max(0, (v - thr) / Math.max(1e-3, 1 - thr));
    switch (d.fuente) {
      case 'banda': return above(c.bands[d.banda]?.env ?? 0);
      case 'hz': return above(c.energyHz ? c.energyHz(d.lo, d.hi) : 0);
      case 'sonoridad': return above(c.loud ?? 0);
      case 'golpe': { const h = c.bands[d.banda]?.hit ?? 0; return h >= Math.max(0.02, thr) ? -h : 0; }
      case 'beat': return c.onBeat && (((c.beat - d.desfase) % Math.max(1, Math.round(d.cada))) + Math.max(1, Math.round(d.cada))) % Math.max(1, Math.round(d.cada)) === 0 ? -(0.5 + 0.5 * Math.min(1, c.beatStrength ?? 0.6)) : 0;
      case 'compás': return c.onDownbeat && (((c.bar - d.desfase) % Math.max(1, Math.round(d.cada))) + Math.max(1, Math.round(d.cada))) % Math.max(1, Math.round(d.cada)) === 0 ? -1 : 0;
      case 'nota': { let m = 0; for (const n of c.notesOn || []) if (n.vel >= thr) m = Math.max(m, n.vel); return -m; }
      case 'sección': return c.onSection ? -1 : 0;
      default: return 0;
    }
  }

  update(c, dt) {
    const d = this.def;
    let raw = this.sample(c);
    this.fired = false;
    if (raw < 0) {   // evento: impulso (con probabilidad y tiempo mínimo entre disparos)
      raw = -raw;
      if (c.t - this.lastFire < d.minimo || Math.random() > d.prob) raw = 0; else { this.lastFire = c.t; this.fired = true; }
      this.env = Math.max(this.env, raw);   // ataque instantáneo para golpes: el ataque solo suaviza fuentes continuas
      raw = 0;
    }
    this.raw = raw;
    const tau = (raw > this.env ? d.ataque : d.liberacion) / 1000;
    this.env += (raw - this.env) * (tau > 0 ? 1 - Math.exp(-dt / tau) : 1);
    return this.env;
  }

  get value() { return Math.max(0, Math.min(1, this.env)); }
}

/** Energía 0..1 de un rango de Hz a partir de las 24 bandas de timbre. */
export function energyFromTimbre(timbre, lo, hi) {
  let s = 0, n = 0;
  for (let i = 0; i < 24; i++) { const c = Math.sqrt(TIMBRE_EDGES[i] * TIMBRE_EDGES[i + 1]); if (c >= lo && c <= hi) { s += timbre[i]; n++; } }
  return n ? Math.min(1, s / n) : 0;
}

/** Juego de triggers con nombre, con sus parámetros en el bus (grupo `trigger`). */
export class TriggerBank {
  constructor(params, defs) {
    this.params = params;
    this.triggers = new Map();
    for (const [name, def] of Object.entries(defs)) this.add(name, def);
  }

  add(name, def) {
    const p = this.params, id = (k) => `trigger.${name}.${k}`, d = (k, o) => { if (!p.has(id(k))) p.define(id(k), o); };
    const t = new Trigger(def);
    d('fuente', { type: 'option', options: TRIGGER_SOURCES, default: t.def.fuente, label: 'fuente' });
    d('banda', { type: 'option', options: BAND_NAMES, default: BAND_NAMES[t.def.banda], label: 'banda' });
    d('lo', { min: 20, max: 16000, default: t.def.lo, step: 1, label: 'hz desde' });
    d('hi', { min: 20, max: 16000, default: t.def.hi, step: 1, label: 'hz hasta' });
    d('umbral', { min: 0, max: 0.95, default: t.def.umbral, step: 0.01, label: 'umbral' });
    d('ataque', { min: 0, max: 2000, default: t.def.ataque, step: 1, label: 'ataque (ms)' });
    d('liberacion', { min: 5, max: 5000, default: t.def.liberacion, step: 1, label: 'liberación (ms)' });
    d('cada', { min: 1, max: 32, default: t.def.cada, step: 1, label: 'cada N (beat / compás)' });
    d('desfase', { min: 0, max: 31, default: t.def.desfase, step: 1, label: 'desfase' });
    d('prob', { min: 0, max: 1, default: t.def.prob, step: 0.01, label: 'probabilidad' });
    d('minimo', { min: 0, max: 5, default: t.def.minimo, step: 0.01, label: 'mínimo entre disparos (s)' });
    this.triggers.set(name, t);
    return t;
  }

  update(cues, dt) {
    const p = this.params;
    for (const [name, t] of this.triggers) {
      const g = (k) => p.get(`trigger.${name}.${k}`);
      const d = t.def;
      d.fuente = g('fuente'); d.banda = Math.max(0, BAND_NAMES.indexOf(g('banda'))); d.lo = g('lo'); d.hi = g('hi'); d.umbral = g('umbral');
      d.ataque = g('ataque'); d.liberacion = g('liberacion'); d.cada = g('cada'); d.desfase = g('desfase'); d.prob = g('prob'); d.minimo = g('minimo');
      t.update(cues, dt);
      p.feed(`trig:${name}`, t.value, 'trigger');
    }
  }

  get(name) { return this.triggers.get(name)?.value ?? 0; }
  fired(name) { return !!this.triggers.get(name)?.fired; }
}

/** Triggers por defecto del escenario (los mismos que usa el rig). */
export const STAGE_TRIGGERS = {
  kick: { fuente: 'golpe', banda: 0, umbral: 0.3, ataque: 4, liberacion: 240 },
  bajo: { fuente: 'hz', lo: 40, hi: 400, umbral: 0.15, ataque: 12, liberacion: 180 },
  caja: { fuente: 'golpe', banda: 2, umbral: 0.4, ataque: 3, liberacion: 150 },
  hats: { fuente: 'golpe', banda: 4, umbral: 0.35, ataque: 2, liberacion: 90 },
  beat: { fuente: 'beat', cada: 1, ataque: 2, liberacion: 260 },
  compas: { fuente: 'compás', cada: 1, ataque: 2, liberacion: 600 },
  cielo: { fuente: 'golpe', banda: 0, umbral: 0.5, ataque: 6, liberacion: 420 },
  seccion: { fuente: 'sección', ataque: 2, liberacion: 1800 },
  voz: { fuente: 'hz', lo: 300, hi: 3000, umbral: 0.25, ataque: 30, liberacion: 250 },
};
