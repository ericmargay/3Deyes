import * as THREE from 'three';
import { pathOf, captureOverride, MATERIAL_TYPES } from '../Project.js';
import { EASE_NAMES } from '../Timeline.js';

const DEG = 180 / Math.PI;
const SIDES = [['frente', THREE.FrontSide], ['dorso', THREE.BackSide], ['ambos', THREE.DoubleSide]];

/**
 * Inspector (estilo Spline): transformación, eventos, material (con texturas),
 * visibilidad y sombras, luces; ajustes de escena cuando no hay selección;
 * edición del keyframe o cue elegido.
 */
export class Inspector {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx; // ver editor.js
    this.obj = null; this.key = null; this.cue = null;
    this.render();
  }

  show(obj) { this.obj = obj; this.key = null; this.cue = null; this.render(); }
  showKey(track, key) { this.key = { track, key }; this.cue = null; this.render(); }
  showCue(cue) { this.cue = cue; this.key = null; this.render(); }

  refresh() {
    if (!this.obj) return;
    for (const inp of this.el.querySelectorAll('input[data-prop]')) {
      if (document.activeElement === inp) continue;
      const v = this.read(inp.dataset.prop);
      if (inp.type === 'checkbox') inp.checked = !!v; else if (inp.type === 'color') inp.value = v; else inp.value = typeof v === 'number' ? +v.toFixed(3) : v;
    }
  }

  mat() { const m = this.obj?.material; return Array.isArray(m) ? m[0] : m; }

  read(prop) {
    const o = this.obj;
    const [a, b] = prop.split('.');
    if (a === 'rotation') return o.rotation[b] * DEG;
    if (a === 'material') { const m = this.mat(); const v = m?.[b]; return v instanceof THREE.Color ? '#' + v.getHexString() : v; }
    if (b) return o[a][b];
    return o[a];
  }

  write(prop, value) {
    const o = this.obj;
    const [a, b] = prop.split('.');
    if (a === 'rotation') o.rotation[b] = value / DEG;
    else if (a === 'material') { const m = this.mat(); if (!m) return; if (m[b] instanceof THREE.Color) m[b].set(value); else m[b] = value; m.needsUpdate = true; }
    else if (a === 'color' && o.isLight) o.color.set(value);
    else if (b) o[a][b] = value;
    else o[a] = value;
    this.ctx.onOverride(o);
  }

  hasKey(target) { return !!this.ctx.timeline.clip?.tracks.find((t) => t.target === target)?.keys.length; }
  keyTarget(prop) { return `obj:${pathOf(this.obj, this.ctx.root())}:${prop}`; }
  addKey(prop) {
    let v = this.read(prop);
    if (prop.startsWith('rotation.')) v = v / DEG;
    if (typeof v !== 'number' && typeof v !== 'boolean') return;
    this.ctx.timeline.setKey(this.keyTarget(prop), v);
    this.ctx.onKeysChanged(); this.render();
  }

  // ---------- helpers de markup ----------
  num(label, prop, step = 0.01, keyable = true) {
    const has = keyable && this.hasKey(this.keyTarget(prop));
    return `<div class="row"><span class="lbl">${label}</span><input type="number" step="${step}" data-prop="${prop}" value="${+(+this.read(prop) || 0).toFixed(3)}">${keyable ? `<button class="key${has ? ' has' : ''}" data-key="${prop}" title="keyframe">◆</button>` : ''}</div>`;
  }
  vec(label, base, step = 0.01) {
    const has = ['x', 'y', 'z'].some((c) => this.hasKey(this.keyTarget(base + '.' + c)));
    return `<div class="row"><span class="lbl">${label}</span>${['x', 'y', 'z'].map((c) => `<input type="number" step="${step}" data-prop="${base}.${c}" value="${+(+this.read(base + '.' + c)).toFixed(3)}" title="${c}">`).join('')}<button class="key${has ? ' has' : ''}" data-keyvec="${base}" title="keyframe x y z">◆</button></div>`;
  }
  check(label, prop, keyable = false) {
    return `<div class="row"><span class="lbl">${label}</span><input type="checkbox" data-prop="${prop}" ${this.read(prop) ? 'checked' : ''}>${keyable ? `<button class="key${this.hasKey(this.keyTarget(prop)) ? ' has' : ''}" data-key="${prop}">◆</button>` : ''}</div>`;
  }

  render() {
    const el = this.el;
    el.innerHTML = '';
    if (this.key) return this.renderKey();
    if (this.cue) return this.renderCue();
    if (!this.obj) return this.renderScene();
    const o = this.obj;
    const path = pathOf(o, this.ctx.root());
    const isAdded = !!o.userData.added;
    let html = `<div class="sec"><h3>${o.type} <span class="grow"></span><button data-act="focus" title="enfocar (F)">⌖</button><button data-act="dup" title="duplicar">⧉</button>${isAdded ? '<button data-act="del" title="borrar objeto">🗑</button>' : '<button data-act="reset" title="quitar cambios guardados">↺</button>'}</h3>
      <div class="row"><span class="lbl">nombre</span><input type="text" data-prop="name" value="${o.name}"></div>
      <div class="row"><span class="lbl">ruta</span><span class="muted" style="overflow:hidden;text-overflow:ellipsis" title="${path}">${path}</span></div>
      ${this.check('visible', 'visible', true)}
    </div>
    <div class="sec"><h3>transformación</h3>${this.vec('posición', 'position')}${this.vec('rotación °', 'rotation', 1)}${this.vec('escala', 'scale')}</div>`;

    // eventos del objeto (reglas con clic sobre su ruta)
    const rules = this.ctx.rulesFor(path);
    html += `<div class="sec"><h3>eventos <span class="grow"></span><button data-act="event">+ al hacer clic</button></h3>${rules.length ? rules.map((r) => `<div class="row muted">▸ ${r}</div>`).join('') : '<div class="muted">Sin eventos. "+ al hacer clic" crea una regla para este objeto en Interacciones.</div>'}</div>`;

    const m = this.mat();
    if (m) {
      html += `<div class="sec"><h3>material <span class="grow"></span><select data-mtype>${MATERIAL_TYPES.map((t) => `<option${m.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select></h3>`;
      if (m.color) html += `<div class="row"><span class="lbl">color</span><input type="color" data-prop="material.color" value="${this.read('material.color')}"></div>`;
      if (m.emissive) html += `<div class="row"><span class="lbl">emisivo</span><input type="color" data-prop="material.emissive" value="${this.read('material.emissive')}"></div>` + this.num('intensidad', 'material.emissiveIntensity', 0.05);
      if ('roughness' in m) html += this.num('rugosidad', 'material.roughness');
      if ('metalness' in m) html += this.num('metal', 'material.metalness');
      if ('clearcoat' in m) html += this.num('barniz', 'material.clearcoat');
      if ('transmission' in m) html += this.num('transmisión', 'material.transmission');
      html += this.num('opacidad', 'material.opacity');
      html += this.check('transparente', 'material.transparent');
      if ('wireframe' in m) html += this.check('wireframe', 'material.wireframe', true);
      if ('flatShading' in m) html += this.check('facetado', 'material.flatShading');
      html += `<div class="row"><span class="lbl">lados</span><select data-side>${SIDES.map(([l, v]) => `<option value="${v}"${m.side === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
      if ('map' in m) html += `<div class="row"><span class="lbl">textura</span><button data-act="tex">${m.map ? 'cambiar…' : 'imagen…'}</button>${m.map ? '<button data-act="texdel">×</button><input type="number" step="0.5" min="0.1" data-repeat value="' + (m.map.repeat?.x ?? 1) + '" title="repetición">' : ''}</div>`;
      html += '</div>';
      html += `<div class="sec"><h3>sombras</h3>${this.check('proyecta', 'castShadow')}${this.check('recibe', 'receiveShadow')}</div>`;
    }
    if (o.isLight) {
      html += `<div class="sec"><h3>luz</h3><div class="row"><span class="lbl">color</span><input type="color" data-prop="color" value="#${o.color.getHexString()}"></div>${this.num('intensidad', 'intensity', 0.1)}`;
      if ('distance' in o) html += this.num('alcance', 'distance', 0.5);
      if ('angle' in o) html += this.num('ángulo', 'angle', 0.01);
      if ('castShadow' in o && !o.isAmbientLight && !o.isHemisphereLight) html += this.check('sombras', 'castShadow');
      html += '</div>';
    }
    if (o.geometry) { const g = o.geometry, n = g.attributes.position?.count ?? 0; html += `<div class="sec muted">geometría ${g.type} · ${n} vértices</div>`; }
    el.innerHTML = html;

    for (const inp of el.querySelectorAll('input[data-prop]')) {
      inp.addEventListener('input', () => {
        const prop = inp.dataset.prop;
        const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) : inp.value;
        this.write(prop, v);
        if (this.ctx.recording?.() && inp.type !== 'color' && prop !== 'name') this.addKey(prop);
      });
    }
    for (const b of el.querySelectorAll('button[data-key]')) b.onclick = () => this.addKey(b.dataset.key);
    for (const b of el.querySelectorAll('button[data-keyvec]')) b.onclick = () => { for (const c of ['x', 'y', 'z']) this.addKey(`${b.dataset.keyvec}.${c}`); };
    el.querySelector('[data-act=focus]').onclick = () => this.ctx.focus(o);
    el.querySelector('[data-act=dup]').onclick = () => this.ctx.duplicate(o);
    el.querySelector('[data-act=reset]')?.addEventListener('click', () => { this.ctx.resetOverride(o); this.render(); });
    el.querySelector('[data-act=del]')?.addEventListener('click', () => this.ctx.removeAdded(o));
    el.querySelector('[data-act=event]').onclick = () => this.ctx.addClickRule(path);
    el.querySelector('[data-mtype]')?.addEventListener('change', (e) => { this.ctx.setMaterialType(o, e.target.value); this.render(); });
    el.querySelector('[data-side]')?.addEventListener('change', (e) => { const mm = this.mat(); mm.side = Number(e.target.value); mm.needsUpdate = true; this.ctx.onOverride(o); });
    el.querySelector('[data-act=tex]')?.addEventListener('click', () => this.ctx.pickTexture(o).then(() => this.render()));
    el.querySelector('[data-act=texdel]')?.addEventListener('click', () => { const mm = this.mat(); mm.map = null; delete mm.userData.mapId; mm.needsUpdate = true; this.ctx.onOverride(o); this.render(); });
    el.querySelector('[data-repeat]')?.addEventListener('input', (e) => { const mm = this.mat(); if (mm.map) { mm.map.repeat.setScalar(Number(e.target.value)); this.ctx.onOverride(o); } });
  }

  renderScene() {
    const root = this.ctx.root();
    if (!root) { this.el.innerHTML = '<div class="sec muted">cargando escena…</div>'; return; }
    const s = this.ctx.settings();
    const bg = root?.background instanceof THREE.Color ? '#' + root.background.getHexString() : '#000000';
    const fog = root?.fog?.density ?? 0;
    const p = this.ctx.params;
    const prow = (label, id, step = 0.01) => p.has(id) ? `<div class="row"><span class="lbl">${label}</span><input type="range" min="${p.def(id).min}" max="${p.def(id).max}" step="${step}" data-param="${id}" value="${p.get(id)}" style="width:120px"><span class="muted" data-pv="${id}">${(+p.get(id)).toFixed(2)}</span></div>` : '';
    this.el.innerHTML = `<div class="sec"><h3>escena</h3>
      <div class="row"><span class="lbl">fondo</span><input type="color" id="sBg" value="${bg}"></div>
      <div class="row"><span class="lbl">niebla</span><input type="range" id="sFog" min="0" max="0.2" step="0.001" value="${fog}" style="width:120px"><span class="muted" id="sFogV">${fog.toFixed(3)}</span></div>
      <div class="row"><span class="lbl">color niebla</span><input type="color" id="sFogC" value="${root?.fog ? '#' + root.fog.color.getHexString() : bg}"></div>
      ${prow('exposición', 'look.exposure')}${prow('bloom', 'look.bloom')}${prow('umbral bloom', 'look.bloomThreshold')}
      <div class="row"><span class="lbl">profundidad</span><input type="checkbox" id="sDepth" ${p.get('look.depth') ? 'checked' : ''}> <span class="muted">mapa de profundidad</span></div>
    </div>
    <div class="sec"><h3>estéreo</h3>${prow('separación ojos', 'stereo.eyeSep', 0.001)}${prow('convergencia', 'stereo.focus', 0.01)}${prow('tamaño imagen', 'stereo.scale', 0.001)}${prow('separación', 'stereo.gap', 0.001)}</div>
    <div class="sec muted">Seleccioná un objeto para ver su transformación, eventos, material y sombras. ◆ graba un keyframe; con ● grabar activo, cada cambio crea keyframes solo. "+ agregar" en la barra superior crea primitivas, luces y texto.</div>`;
    const el = this.el;
    el.querySelector('#sBg').oninput = (e) => { s.background = e.target.value; this.ctx.applySettings(); };
    el.querySelector('#sFog').oninput = (e) => { s.fogDensity = Number(e.target.value); el.querySelector('#sFogV').textContent = s.fogDensity.toFixed(3); this.ctx.applySettings(); };
    el.querySelector('#sFogC').oninput = (e) => { s.fogColor = e.target.value; this.ctx.applySettings(); };
    el.querySelector('#sDepth').onchange = (e) => p.set('look.depth', e.target.checked, 'gui');
    for (const r of el.querySelectorAll('[data-param]')) r.oninput = () => { p.set(r.dataset.param, Number(r.value), 'gui'); el.querySelector(`[data-pv="${r.dataset.param}"]`).textContent = (+r.value).toFixed(2); };
  }

  renderKey() {
    const { track, key } = this.key;
    const isNum = typeof key.v === 'number';
    this.el.innerHTML = `<div class="sec"><h3>keyframe</h3>
      <div class="row"><span class="lbl">pista</span><span class="muted" style="overflow:hidden;text-overflow:ellipsis">${track.target}</span></div>
      <div class="row"><span class="lbl">tiempo (s)</span><input type="number" step="0.01" id="kT" value="${+key.t.toFixed(3)}"></div>
      <div class="row"><span class="lbl">valor</span>${isNum ? `<input type="number" step="0.01" id="kV" value="${+key.v.toFixed(4)}">` : `<input type="text" id="kV" value="${key.v}">`}</div>
      <div class="row"><span class="lbl">curva</span><select id="kE">${EASE_NAMES.map((e) => `<option${e === key.e ? ' selected' : ''}>${e}</option>`).join('')}</select></div>
      <div class="row"><button id="kDel">borrar keyframe</button><button id="kDelTrack">borrar pista</button></div></div>`;
    const el = this.el;
    el.querySelector('#kT').oninput = (e) => { key.t = Number(e.target.value); track.keys.sort((a, b) => a.t - b.t); this.ctx.onKeysChanged(); };
    el.querySelector('#kV').oninput = (e) => { key.v = isNum ? Number(e.target.value) : (e.target.value === 'true' ? true : e.target.value === 'false' ? false : e.target.value); this.ctx.onKeysChanged(); };
    el.querySelector('#kE').onchange = (e) => { key.e = e.target.value; this.ctx.onKeysChanged(); };
    el.querySelector('#kDel').onclick = () => { track.keys.splice(track.keys.indexOf(key), 1); this.key = null; this.ctx.onKeysChanged(); this.render(); };
    el.querySelector('#kDelTrack').onclick = () => { const tr = this.ctx.timeline.clip.tracks; tr.splice(tr.indexOf(track), 1); this.key = null; this.ctx.onKeysChanged(); this.render(); };
  }

  renderCue() {
    const cue = this.cue;
    this.el.innerHTML = `<div class="sec"><h3>cue</h3><div class="row"><span class="lbl">tiempo (s)</span><input type="number" step="0.01" id="cT" value="${+cue.t.toFixed(3)}"></div><div id="cueAction"></div><div class="row"><button id="cDel">borrar cue</button></div></div>`;
    this.el.querySelector('#cT').oninput = (e) => { cue.t = Number(e.target.value); this.ctx.onKeysChanged(); };
    this.ctx.actionEditor(this.el.querySelector('#cueAction'), cue.action, (a) => { cue.action = a; this.ctx.onKeysChanged(); });
    this.el.querySelector('#cDel').onclick = () => { const cs = this.ctx.timeline.clip.cues; cs.splice(cs.indexOf(cue), 1); this.cue = null; this.ctx.onKeysChanged(); this.render(); };
  }
}

export { captureOverride };
