/**
 * Reglas de interacción: "cuando <disparador> → <acción>".
 *
 * Disparadores (on.type):
 *   click      { path? }          clic sobre un objeto (ruta o "*" cualquiera) / clic en el centro de la vista
 *   key        { key }            tecla
 *   input      { sourceKey, min } control físico (midi:1:note60, osc:/x, serial:b0, audio:beat) con n ≥ min
 *   beat                          golpe detectado del audio
 *   gate / hit / enter            eventos que emiten las escenas (portal atravesado, objeto activado, entrada a la escena)
 *   paramAbove { id, value }      un parámetro cruza un umbral hacia arriba
 *   cue                           (los cues de la línea de tiempo llaman directamente a run)
 *
 * Acciones (do.type):
 *   set     { id, value }                 fija un parámetro
 *   tween   { id, value, duration, ease } lleva un parámetro a un valor en el tiempo
 *   toggle  { id }                        invierte un booleano
 *   trigger { id }                        dispara un parámetro tipo trigger
 *   scene   { value }                     cambia de escena     ·  nextScene
 *   play / pause / stop / seek { value }  línea de tiempo
 */
import { EASES } from './Timeline.js';
import { findByPath, getProp, setProp } from './Project.js';

export const TRIGGER_TYPES = ['click', 'key', 'input', 'beat', 'gate', 'hit', 'enter', 'paramAbove'];
export const ACTION_TYPES = ['set', 'tween', 'toggle', 'trigger', 'objSet', 'objTween', 'objToggle', 'scene', 'nextScene', 'play', 'pause', 'stop', 'seek'];

export class RuleEngine {
  constructor(params, ctx = {}) {
    this.params = params;
    this.ctx = ctx;           // { setScene, nextScene, timeline }
    this.rules = [];
    this.tweens = [];
    this.prevValues = new Map();
    this.log = ctx.log || (() => {});
    params.addEventListener('change', (e) => this.onParamChange(e.detail));
    params.addEventListener('input', (e) => this.handle('input', e.detail));
  }

  load(rules) { this.rules = rules || []; this.tweens = []; }

  matches(rule, type, d) {
    const on = rule.on;
    if (on.type !== type) return false;
    switch (type) {
      case 'key': return (on.key || '').toLowerCase() === (d.key || '').toLowerCase();
      case 'click': return !on.path || on.path === '*' || on.path === d.path;
      case 'input': return on.sourceKey === d.sourceKey && d.n >= (on.min ?? 0.5) && d.moved !== false;
      case 'paramAbove': return on.id === d.id && d.prev < on.value && d.value >= on.value;
      default: return true;
    }
  }

  handle(type, detail = {}) {
    for (const r of this.rules) {
      if (r.enabled === false) continue;
      if (this.matches(r, type, detail)) { this.run(r.do, { rule: r, event: detail }); }
    }
  }

  onParamChange({ id, value }) {
    const prev = this.prevValues.get(id);
    this.prevValues.set(id, value);
    if (prev !== undefined && typeof value === 'number') this.handle('paramAbove', { id, value, prev });
  }

  run(a, info = {}) {
    if (!a) return;
    const p = this.params;
    switch (a.type) {
      case 'set': p.set(a.id, this.coerce(a.id, a.value), 'rule'); break;
      case 'toggle': p.set(a.id, !p.get(a.id), 'rule'); break;
      case 'trigger': p.set(a.id, 1, 'rule'); break;
      case 'tween': {
        const from = p.get(a.id);
        if (typeof from !== 'number') { p.set(a.id, this.coerce(a.id, a.value), 'rule'); break; }
        this.tweens = this.tweens.filter((t) => t.id !== a.id);
        this.tweens.push({ id: a.id, from, to: Number(a.value), dur: Math.max(0.01, Number(a.duration) || 1), t: 0, ease: EASES[a.ease] || EASES.smooth });
        break;
      }
      case 'objSet': { const o = findByPath(this.ctx.getRoot?.(), a.path); if (o) setProp(o, a.prop, this.parse(a.value)); break; }
      case 'objToggle': { const o = findByPath(this.ctx.getRoot?.(), a.path); if (o) setProp(o, a.prop || 'visible', !getProp(o, a.prop || 'visible')); break; }
      case 'objTween': {
        const o = findByPath(this.ctx.getRoot?.(), a.path); if (!o) break;
        const from = Number(getProp(o, a.prop)); if (Number.isNaN(from)) { setProp(o, a.prop, this.parse(a.value)); break; }
        const key = `${a.path}:${a.prop}`;
        this.tweens = this.tweens.filter((t) => t.key !== key);
        this.tweens.push({ key, obj: o, prop: a.prop, from, to: Number(a.value), dur: Math.max(0.01, Number(a.duration) || 1), t: 0, ease: EASES[a.ease] || EASES.smooth });
        break;
      }
      case 'scene': this.ctx.setScene?.(a.value); break;
      case 'nextScene': this.ctx.nextScene?.(); break;
      case 'play': this.ctx.timeline?.play(); break;
      case 'pause': this.ctx.timeline?.pause(); break;
      case 'stop': this.ctx.timeline?.stop(); break;
      case 'seek': this.ctx.timeline?.seek(Number(a.value) || 0); if (a.play) this.ctx.timeline?.play(); break;
      default: break;
    }
    this.log(`regla → ${a.type} ${a.id ?? a.value ?? ''}`, info);
  }

  parse(v) { if (v === 'true') return true; if (v === 'false') return false; const n = Number(v); return Number.isNaN(n) ? v : n; }

  coerce(id, value) {
    const d = this.params.def(id);
    if (!d) return value;
    if (d.type === 'number') return Number(value);
    if (d.type === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
    return value;
  }

  update(dt) {
    for (const tw of this.tweens) {
      tw.t = Math.min(tw.dur, tw.t + dt);
      const k = tw.ease(tw.t / tw.dur);
      const v = tw.from + (tw.to - tw.from) * k;
      if (tw.obj) setProp(tw.obj, tw.prop, v); else this.params.set(tw.id, v, 'rule');
    }
    this.tweens = this.tweens.filter((tw) => tw.t < tw.dur);
  }
}

export function describeRule(r) {
  const on = r.on, a = r.do;
  const onTxt = { click: `clic en ${on.path || 'cualquier objeto'}`, key: `tecla "${on.key}"`, input: `${on.sourceKey} ≥ ${on.min ?? 0.5}`, beat: 'beat del audio', gate: 'portal atravesado', hit: 'objeto activado', enter: 'al entrar a la escena', paramAbove: `${on.id} ≥ ${on.value}` }[on.type] || on.type;
  const doTxt = { set: `${a.id} = ${a.value}`, tween: `${a.id} → ${a.value} en ${a.duration}s`, objSet: `${a.path}.${a.prop} = ${a.value}`, objTween: `${a.path}.${a.prop} → ${a.value} en ${a.duration}s`, objToggle: `alternar ${a.path}.${a.prop || 'visible'}`, toggle: `alternar ${a.id}`, trigger: `disparar ${a.id}`, scene: `escena ${a.value}`, nextScene: 'siguiente escena', play: 'reproducir', pause: 'pausar', stop: 'detener', seek: `ir a ${a.value}s` }[a.type] || a.type;
  return `${onTxt}  ⟶  ${doTxt}`;
}
