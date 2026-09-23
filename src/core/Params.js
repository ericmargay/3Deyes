/**
 * Bus central de parámetros.
 *
 * Todo lo que se puede controlar (desde la GUI, MIDI/Ableton, ESP32 por serial
 * u OSC por WebSocket) pasa por aquí. Cada parámetro tiene un id con forma
 * "grupo.nombre" (ej. "stereo.eyeSep", "fluid.speed").
 *
 * Los controladores externos mandan valores normalizados 0..1 con setNormalized()
 * y aquí se mapean al rango real del parámetro.
 */
export class Params extends EventTarget {
  constructor() {
    super();
    this.defs = new Map();   // id -> { min, max, step, value, default, type, options, label, group }
    this.bindings = new Map(); // "midi:ch:cc" | "serial:k0" | "osc:/x" -> id
    this.learnTarget = null;   // id esperando asignación desde un controlador
    this.lastFeed = new Map();  // último valor recibido por fuente
    this.pending = {};          // valores cargados para ids aún no definidos
  }

  /** Marca un parámetro para que el próximo control físico que se mueva quede asignado. */
  learn(id) {
    this.learnTarget = this.learnTarget === id ? null : id;
    this.dispatchEvent(new CustomEvent('learn', { detail: { id: this.learnTarget } }));
  }

  bind(sourceKey, id) {
    this.bindings.set(sourceKey, id);
    this.dispatchEvent(new CustomEvent('bind', { detail: { sourceKey, id } }));
    this.save();
  }

  unbind(id) {
    for (const [k, v] of [...this.bindings]) if (v === id) this.bindings.delete(k);
    this.save();
  }

  bindingFor(id) {
    for (const [k, v] of this.bindings) if (v === id) return k;
    return null;
  }

  /**
   * Entrada genérica de un controlador: sourceKey identifica el control físico,
   * n es el valor normalizado 0..1. Si hay un parámetro en modo "learn", se asigna.
   * También acepta ids directos ("fluid.speed") como sourceKey.
   */
  feed(sourceKey, n, source = 'ext') {
    // en modo learn solo asignamos fuentes que se "mueven" (evita que el audio
    // continuo o un knob quieto capturen la asignación)
    const last = this.lastFeed.get(sourceKey);
    this.lastFeed.set(sourceKey, n);
    const moved = last === undefined || Math.abs(n - last) > 0.05;
    if (this.learnTarget && moved) {
      this.bind(sourceKey, this.learnTarget);
      const id = this.learnTarget;
      this.learnTarget = null;
      this.dispatchEvent(new CustomEvent('learn', { detail: { id: null } }));
      return this.setNormalized(id, n, source);
    }
    const id = this.bindings.get(sourceKey) ?? (this.defs.has(sourceKey) ? sourceKey : null);
    if (!id) return false;
    return this.setNormalized(id, n, source);
  }

  /** Define un parámetro. type: 'number' | 'boolean' | 'option' | 'trigger' */
  define(id, opts = {}) {
    const def = {
      id,
      group: id.split('.')[0],
      label: opts.label ?? id.split('.').slice(1).join('.'),
      type: opts.type ?? (typeof opts.default === 'boolean' ? 'boolean' : 'number'),
      min: opts.min ?? 0,
      max: opts.max ?? 1,
      step: opts.step ?? 0,
      options: opts.options ?? null,
      default: opts.default ?? (opts.min ?? 0),
      value: opts.default ?? (opts.min ?? 0),
      onChange: opts.onChange ?? null,
    };
    if (this.defs.has(id)) def.value = this.defs.get(id).value; // preserva valor al redefinir
    this.defs.set(id, def);
    if (id in this.pending) { const v = this.pending[id]; delete this.pending[id]; this.set(id, v, 'restore'); }
    this.dispatchEvent(new CustomEvent('define', { detail: def }));
    return def;
  }

  has(id) { return this.defs.has(id); }
  get(id) { const d = this.defs.get(id); return d ? d.value : undefined; }
  def(id) { return this.defs.get(id); }

  /** Devuelve un proxy de lectura para un grupo: p.fluid.speed */
  group(name) {
    const self = this;
    return new Proxy({}, { get: (_, k) => self.get(`${name}.${k}`) });
  }

  set(id, value, source = 'local') {
    const d = this.defs.get(id);
    if (!d) return false;
    let v = value;
    if (d.type === 'number') {
      v = Number(v);
      if (Number.isNaN(v)) return false;
      if (d.step) v = Math.round(v / d.step) * d.step;
      v = Math.min(d.max, Math.max(d.min, v));
    } else if (d.type === 'boolean') {
      v = !!v;
    } else if (d.type === 'option') {
      if (typeof v === 'number') v = d.options[Math.min(d.options.length - 1, Math.max(0, Math.floor(v)))];
      if (!d.options.includes(v)) return false;
    } else if (d.type === 'trigger') {
      v = (d.value | 0) + 1;
    }
    if (v === d.value && d.type !== 'trigger') return true;
    d.value = v;
    if (d.onChange) d.onChange(v);
    this.dispatchEvent(new CustomEvent('change', { detail: { id, value: v, source } }));
    return true;
  }

  /** Recibe 0..1 desde un controlador externo y lo mapea al rango del parámetro. */
  setNormalized(id, n, source = 'ext') {
    const d = this.defs.get(id);
    if (!d) return false;
    n = Math.min(1, Math.max(0, Number(n) || 0));
    if (d.type === 'number') return this.set(id, d.min + (d.max - d.min) * n, source);
    if (d.type === 'boolean') return this.set(id, n >= 0.5, source);
    if (d.type === 'option') return this.set(id, d.options[Math.min(d.options.length - 1, Math.floor(n * d.options.length))], source);
    if (d.type === 'trigger') return n > 0.5 ? this.set(id, 1, source) : true;
    return false;
  }

  getNormalized(id) {
    const d = this.defs.get(id);
    if (!d) return 0;
    if (d.type === 'number') return d.max === d.min ? 0 : (d.value - d.min) / (d.max - d.min);
    if (d.type === 'boolean') return d.value ? 1 : 0;
    if (d.type === 'option') return d.options.indexOf(d.value) / Math.max(1, d.options.length - 1);
    return 0;
  }

  reset(group = null) {
    for (const d of this.defs.values()) {
      if (group && d.group !== group) continue;
      if (d.type !== 'trigger') this.set(d.id, d.default, 'reset');
    }
  }

  onChange(cb) {
    const h = (e) => cb(e.detail.id, e.detail.value, e.detail.source);
    this.addEventListener('change', h);
    return () => this.removeEventListener('change', h);
  }

  /** Devuelve los ids de un grupo (o todos). */
  ids(group = null) {
    return [...this.defs.keys()].filter((id) => !group || id.startsWith(group + '.'));
  }

  // ---------- persistencia (localStorage) ----------
  toJSON() {
    const values = {};
    for (const [id, d] of this.defs) if (d.type !== 'trigger') values[id] = d.value;
    return { values, bindings: Object.fromEntries(this.bindings) };
  }

  fromJSON(json) {
    if (!json) return;
    for (const [id, v] of Object.entries(json.values ?? {})) { if (this.defs.has(id)) this.set(id, v, 'restore'); else this.pending[id] = v; }
    for (const [k, id] of Object.entries(json.bindings ?? {})) this.bindings.set(k, id);
  }

  /** Copia los valores de ciertos grupos dentro de otra clave (ej. de la calibración a la app). */
  mergeInto(key, groups) {
    let json = {};
    try { json = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { /* */ }
    json.values = json.values || {};
    for (const d of this.defs.values()) if (groups.includes(d.group) && d.type !== 'trigger') json.values[d.id] = d.value;
    try { localStorage.setItem(key, JSON.stringify(json)); } catch (_) { /* */ }
  }

  /** Lee de otra clave solo los valores de ciertos grupos. */
  loadGroups(key, groups) {
    try {
      const json = JSON.parse(localStorage.getItem(key) || '{}');
      for (const [id, v] of Object.entries(json.values || {})) {
        if (!groups.includes(id.split('.')[0])) continue;
        if (this.defs.has(id)) this.set(id, v, 'restore'); else this.pending[id] = v;
      }
    } catch (_) { /* */ }
  }

  save(key = '3deyes.params') {
    try { localStorage.setItem(key, JSON.stringify(this.toJSON())); } catch (_) { /* sin storage */ }
  }

  load(key = '3deyes.params') {
    try { const s = localStorage.getItem(key); if (s) this.fromJSON(JSON.parse(s)); } catch (_) { /* ignora */ }
  }
}
