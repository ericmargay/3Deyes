import { TRIGGER_TYPES, ACTION_TYPES, describeRule } from '../Rules.js';
import { EASE_NAMES } from '../Timeline.js';

const ON_LABELS = { click: 'clic en objeto', key: 'tecla', input: 'control físico (MIDI / OSC / serial / audio)', beat: 'beat del audio', gate: 'portal atravesado (track)', hit: 'objeto activado (track)', enter: 'al entrar a la escena', paramAbove: 'parámetro supera un valor' };
const DO_LABELS = { set: 'fijar parámetro', tween: 'llevar parámetro a un valor', toggle: 'alternar booleano', trigger: 'disparar trigger', objSet: 'objeto: fijar propiedad', objTween: 'objeto: animar propiedad', objToggle: 'objeto: alternar visible', scene: 'ir a escena', nextScene: 'siguiente escena', play: 'reproducir línea de tiempo', pause: 'pausar', stop: 'detener', seek: 'ir a un tiempo' };

const sel = (opts, value, attrs = '') => `<select ${attrs}>${opts.map((o) => `<option value="${o.value ?? o}"${(o.value ?? o) === value ? ' selected' : ''}>${o.label ?? o}</option>`).join('')}</select>`;

/** Editor de una acción (usado por reglas y por cues). */
export function actionEditor(el, action, onChange, ctx) {
  const a = { type: 'set', ...action };
  const paramOpts = ctx.paramOptions();
  const byType = (types) => paramOpts.filter((p) => types.includes(p.type));
  const render = () => {
    let f = `<div class="row"><span class="lbl">acción</span>${sel(ACTION_TYPES.map((t) => ({ value: t, label: DO_LABELS[t] })), a.type, 'data-f="type"')}</div>`;
    if (['set', 'tween'].includes(a.type)) f += `<div class="row"><span class="lbl">parámetro</span>${sel(byType(['number', 'boolean', 'option']), a.id, 'data-f="id"')}</div><div class="row"><span class="lbl">valor</span><input type="text" data-f="value" value="${a.value ?? ''}"></div>`;
    if (a.type === 'tween') f += `<div class="row"><span class="lbl">duración (s)</span><input type="number" step="0.1" data-f="duration" value="${a.duration ?? 1}"></div><div class="row"><span class="lbl">curva</span>${sel(EASE_NAMES, a.ease ?? 'smooth', 'data-f="ease"')}</div>`;
    if (a.type === 'toggle') f += `<div class="row"><span class="lbl">parámetro</span>${sel(byType(['boolean']), a.id, 'data-f="id"')}</div>`;
    if (['objSet', 'objTween', 'objToggle'].includes(a.type)) {
      f += `<div class="row"><span class="lbl">objeto (ruta)</span><input type="text" data-f="path" value="${a.path ?? ''}" placeholder="decoración/nudo"><button data-pick="1" title="elegir en el viewport">⌖</button></div>`;
      if (a.type !== 'objToggle') f += `<div class="row"><span class="lbl">propiedad</span>${sel(['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale.x', 'scale.y', 'scale.z', 'material.opacity', 'material.emissiveIntensity', 'material.roughness', 'material.metalness', 'intensity', 'visible'], a.prop ?? 'position.y', 'data-f="prop"')}</div><div class="row"><span class="lbl">valor</span><input type="text" data-f="value" value="${a.value ?? ''}"></div>`;
      if (a.type === 'objTween') f += `<div class="row"><span class="lbl">duración (s)</span><input type="number" step="0.1" data-f="duration" value="${a.duration ?? 1}"></div><div class="row"><span class="lbl">curva</span>${sel(EASE_NAMES, a.ease ?? 'smooth', 'data-f="ease"')}</div>`;
    }
    if (a.type === 'trigger') f += `<div class="row"><span class="lbl">trigger</span>${sel(byType(['trigger']), a.id, 'data-f="id"')}</div>`;
    if (a.type === 'scene') f += `<div class="row"><span class="lbl">escena</span>${sel(ctx.sceneKeys, a.value, 'data-f="value"')}</div>`;
    if (a.type === 'seek') f += `<div class="row"><span class="lbl">tiempo (s)</span><input type="number" step="0.1" data-f="value" value="${a.value ?? 0}"></div><div class="row"><span class="lbl">y reproducir</span><input type="checkbox" data-f="play" ${a.play ? 'checked' : ''}></div>`;
    el.innerHTML = f;
    for (const inp of el.querySelectorAll('[data-f]')) {
      inp.onchange = () => {
        const k = inp.dataset.f;
        a[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (k === 'type') { delete a.id; delete a.value; }
        if (k === 'id' || k === 'type') { const first = el.querySelector('[data-f=id]'); if (first && !a.id) a.id = first.value; }
        onChange({ ...a }); render();
      };
    }
    const pick = el.querySelector('[data-pick]'); if (pick) pick.onclick = () => { pick.textContent = '…'; ctx.capture?.click((p) => { a.path = p; onChange({ ...a }); render(); }); };
    const propSel = el.querySelector('[data-f=prop]'); if (propSel && !a.prop) { a.prop = propSel.value; onChange({ ...a }); }
    // asegurar id por defecto
    const first = el.querySelector('[data-f=id]'); if (first && !a.id) { a.id = first.value; onChange({ ...a }); }
  };
  render();
}

function triggerEditor(el, on, onChange, ctx, capture) {
  const o = { type: 'click', ...on };
  const render = () => {
    let f = `<div class="row"><span class="lbl">cuando</span>${sel(TRIGGER_TYPES.map((t) => ({ value: t, label: ON_LABELS[t] })), o.type, 'data-f="type"')}</div>`;
    if (o.type === 'click') f += `<div class="row"><span class="lbl">objeto</span><input type="text" data-f="path" value="${o.path ?? '*'}" placeholder="* = cualquiera"><button data-cap="click" title="elegir en el viewport">⌖</button></div>`;
    if (o.type === 'key') f += `<div class="row"><span class="lbl">tecla</span><input type="text" data-f="key" value="${o.key ?? ''}"><button data-cap="key">capturar</button></div>`;
    if (o.type === 'input') f += `<div class="row"><span class="lbl">fuente</span><input type="text" data-f="sourceKey" value="${o.sourceKey ?? ''}" placeholder="midi:1:note60"><button data-cap="input">capturar</button></div><div class="row"><span class="lbl">mínimo</span><input type="number" step="0.05" data-f="min" value="${o.min ?? 0.5}"></div>`;
    if (o.type === 'paramAbove') f += `<div class="row"><span class="lbl">parámetro</span>${sel(ctx.paramOptions().filter((p) => p.type === 'number'), o.id, 'data-f="id"')}</div><div class="row"><span class="lbl">valor</span><input type="number" step="0.01" data-f="value" value="${o.value ?? 0.5}"></div>`;
    el.innerHTML = f;
    for (const inp of el.querySelectorAll('[data-f]')) inp.onchange = () => { const k = inp.dataset.f; o[k] = inp.type === 'number' ? Number(inp.value) : inp.value; if (k === 'type') { for (const kk of Object.keys(o)) if (kk !== 'type') delete o[kk]; } onChange({ ...o }); render(); };
    for (const b of el.querySelectorAll('[data-cap]')) b.onclick = () => { b.textContent = '…'; capture[b.dataset.cap]((val) => { const k = b.dataset.cap === 'click' ? 'path' : b.dataset.cap === 'key' ? 'key' : 'sourceKey'; o[k] = val; onChange({ ...o }); render(); }); };
    const first = el.querySelector('[data-f=id]'); if (first && !o.id) { o.id = first.value; onChange({ ...o }); }
  };
  render();
}

/** Lista y formulario de reglas de interacción de la escena actual. */
export class RulesUI {
  constructor(el, ctx) {
    this.el = el; this.ctx = ctx; // { getRules(), onChanged(), capture, editorCtx }
    this.editing = null;
    this.draft = null;
    this.render();
  }

  setRules() { this.editing = null; this.draft = null; this.render(); }

  render() {
    const rules = this.ctx.getRules();
    const list = rules.map((r, i) => `<div class="item${r === this.editing ? ' sel' : ''}"><input type="checkbox" data-en="${i}" ${r.enabled !== false ? 'checked' : ''}><span class="txt" data-edit="${i}" title="editar">${describeRule(r)}</span><button data-del="${i}" title="borrar">×</button></div>`).join('');
    this.el.innerHTML = `<div class="list"><div class="row"><b>Reglas</b><span class="grow" style="flex:1"></span><button id="ruleNew">+ nueva regla</button></div>${list || '<div class="muted">Sin reglas. Una regla conecta un disparador (clic, tecla, MIDI, beat, portal…) con una acción (fijar o animar un parámetro, cambiar de escena, controlar la línea de tiempo).</div>'}</div><div id="ruleForm"></div>`;
    for (const c of this.el.querySelectorAll('[data-en]')) c.onchange = () => { rules[c.dataset.en].enabled = c.checked; this.ctx.onChanged(); };
    for (const s of this.el.querySelectorAll('[data-edit]')) s.onclick = () => { this.editing = rules[s.dataset.edit]; this.draft = JSON.parse(JSON.stringify(this.editing)); this.render(); };
    for (const b of this.el.querySelectorAll('[data-del]')) b.onclick = () => { rules.splice(Number(b.dataset.del), 1); if (this.editing && !rules.includes(this.editing)) { this.editing = null; this.draft = null; } this.ctx.onChanged(); this.render(); };
    this.el.querySelector('#ruleNew').onclick = () => { this.editing = null; this.draft = { id: Math.random().toString(36).slice(2, 8), enabled: true, on: { type: 'click', path: '*' }, do: { type: 'set' } }; this.render(); };
    if (this.draft) this.renderForm(rules);
  }

  renderForm(rules) {
    const f = this.el.querySelector('#ruleForm');
    f.className = 'form';
    f.innerHTML = `<b>${this.editing ? 'editar regla' : 'nueva regla'}</b><div id="onEd"></div><div id="doEd"></div><div class="row"><button id="ruleOk" class="on">${this.editing ? 'guardar' : 'agregar'}</button><button id="ruleCancel">cancelar</button></div>`;
    triggerEditor(f.querySelector('#onEd'), this.draft.on, (o) => { this.draft.on = o; }, this.ctx.editorCtx, this.ctx.capture);
    actionEditor(f.querySelector('#doEd'), this.draft.do, (a) => { this.draft.do = a; }, this.ctx.editorCtx);
    f.querySelector('#ruleOk').onclick = () => {
      if (this.editing) Object.assign(this.editing, this.draft); else rules.push(this.draft);
      this.editing = null; this.draft = null; this.ctx.onChanged(); this.render();
    };
    f.querySelector('#ruleCancel').onclick = () => { this.editing = null; this.draft = null; this.render(); };
  }
}

/** Tabla de conexiones: fuente física → parámetro, con mapeo. */
export class ConnectionsUI {
  constructor(el, ctx) {
    this.el = el; this.ctx = ctx; // { params, onChanged() }
    const p = ctx.params;
    const re = () => this.render();
    p.addEventListener('bind', re); p.addEventListener('learn', re); p.addEventListener('define', () => { clearTimeout(this._t); this._t = setTimeout(re, 300); });
    this.render();
  }

  render() {
    const p = this.ctx.params;
    const rows = [...p.bindings].map(([src, id]) => {
      const m = p.maps.get(src) || { min: 0, max: 1, invert: false, smooth: 0 };
      return `<tr data-src="${src}"><td>${src}</td><td title="${id}">${id}</td><td><input type="number" step="0.05" data-m="min" value="${m.min ?? 0}"></td><td><input type="number" step="0.05" data-m="max" value="${m.max ?? 1}"></td><td><input type="checkbox" data-m="invert" ${m.invert ? 'checked' : ''}></td><td><input type="number" step="0.05" min="0" max="0.98" data-m="smooth" value="${m.smooth ?? 0}"></td><td><button data-unbind="${src}">×</button></td></tr>`;
    }).join('');
    const opts = [...p.defs.values()].filter((d) => d.type !== 'trigger' || true).map((d) => `<option value="${d.id}">${d.id}</option>`).join('');
    this.el.innerHTML = `<div class="list">
      <div class="row"><b>Conexiones</b></div>
      <div class="muted">Asignar: elegí un parámetro y apretá <b>learn</b>, después mové el control (knob MIDI, potenciómetro del ESP32, mensaje OSC o hacé ruido para el audio). También: doble clic en el nombre del parámetro en la pestaña Parámetros.</div>
      <div class="row" style="margin-top:6px"><select id="learnSel" style="max-width:190px">${opts}</select><button id="learnBtn" class="${p.learnTarget ? 'on' : ''}">${p.learnTarget ? `esperando ${p.learnTarget}…` : 'learn'}</button></div>
      <table class="conn" style="margin-top:8px"><tr><th>fuente</th><th>parámetro</th><th>min</th><th>max</th><th>inv</th><th>suav.</th><th></th></tr>${rows || '<tr><td colspan="7" class="muted">sin conexiones</td></tr>'}</table>
      <div class="muted" style="margin-top:6px">min/max: rango del parámetro (0..1 = completo) que recorre el control · suav.: filtro 0..0.98</div>
    </div>`;
    this.el.querySelector('#learnBtn').onclick = () => { p.learn(this.el.querySelector('#learnSel').value); this.render(); };
    for (const tr of this.el.querySelectorAll('tr[data-src]')) {
      const src = tr.dataset.src;
      for (const inp of tr.querySelectorAll('[data-m]')) inp.onchange = () => {
        const m = p.maps.get(src) || { min: 0, max: 1, invert: false, smooth: 0 };
        m[inp.dataset.m] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
        p.maps.set(src, m); this.ctx.onChanged();
      };
    }
    for (const b of this.el.querySelectorAll('[data-unbind]')) b.onclick = () => { p.bindings.delete(b.dataset.unbind); p.maps.delete(b.dataset.unbind); this.ctx.onChanged(); this.render(); };
  }
}
