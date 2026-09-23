import * as THREE from 'three';
import { pathOf, captureOverride } from '../Project.js';
import { EASE_NAMES } from '../Timeline.js';

const DEG = 180 / Math.PI;

/**
 * Inspector: propiedades del objeto seleccionado (transformación, material)
 * con botones ◆ para grabar keyframes, y edición del keyframe / cue elegido.
 */
export class Inspector {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx; // { timeline, project, sceneKey(), root(), onOverride(obj), onKeysChanged(), actionEditor }
    this.obj = null;
    this.key = null;   // { track, key }
    this.cue = null;
    this.render();
  }

  show(obj) { this.obj = obj; this.key = null; this.cue = null; this.render(); }
  showKey(track, key) { this.key = { track, key }; this.cue = null; this.render(); }
  showCue(cue) { this.cue = cue; this.key = null; this.render(); }

  /** Refresca los números cuando el gizmo mueve el objeto. */
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
    else if (b) o[a][b] = value;
    else o[a] = value;
    this.ctx.onOverride(o);
  }

  hasKey(target) { return !!this.ctx.timeline.clip?.tracks.find((t) => t.target === target)?.keys.length; }

  keyTarget(prop) {
    const path = pathOf(this.obj, this.ctx.root());
    return `obj:${path}:${prop.replace('rotation.', 'rotation.')}`;
  }

  addKey(prop) {
    const target = this.keyTarget(prop);
    let v = this.read(prop);
    if (prop.startsWith('rotation.')) v = v / DEG; // en radianes para la pista
    this.ctx.timeline.setKey(target, v);
    this.ctx.onKeysChanged();
    this.render();
  }

  render() {
    const el = this.el;
    el.innerHTML = '';
    if (this.key) return this.renderKey();
    if (this.cue) return this.renderCue();
    const o = this.obj;
    if (!o) { el.innerHTML = '<div class="sec muted">Seleccioná un objeto en el viewport o en la lista.<br><br>◆ graba un keyframe en el tiempo actual.<br>Con ● grabar activo, cada cambio crea keyframes solo.</div>'; return; }
    const path = pathOf(o, this.ctx.root());
    const num = (label, prop, step = 0.01, keyable = true) => {
      const target = keyable ? this.keyTarget(prop) : null;
      return `<div class="row"><span class="lbl">${label}</span><input type="number" step="${step}" data-prop="${prop}" value="${+(+this.read(prop) || 0).toFixed(3)}">${keyable ? `<button class="key${this.hasKey(target) ? ' has' : ''}" data-key="${prop}" title="keyframe">◆</button>` : ''}</div>`;
    };
    const vec = (label, base, step = 0.01) => `<div class="row"><span class="lbl">${label}</span>${['x', 'y', 'z'].map((c) => `<input type="number" step="${step}" data-prop="${base}.${c}" value="${+(+this.read(base + '.' + c)).toFixed(3)}" title="${c}">`).join('')}<button class="key${['x', 'y', 'z'].some((c) => this.hasKey(this.keyTarget(base + '.' + c))) ? ' has' : ''}" data-keyvec="${base}" title="keyframe x y z">◆</button></div>`;
    let html = `<div class="sec"><h3>${o.type} <span class="grow"></span><button data-act="focus" title="enfocar">⌖</button><button data-act="reset" title="quitar cambios guardados">↺</button></h3>
      <div class="row"><span class="lbl">nombre</span><input type="text" data-prop="name" value="${o.name}"></div>
      <div class="row"><span class="lbl">ruta</span><span class="muted" style="overflow:hidden;text-overflow:ellipsis">${path}</span></div>
      <div class="row"><span class="lbl">visible</span><input type="checkbox" data-prop="visible" ${o.visible ? 'checked' : ''}><button class="key${this.hasKey(this.keyTarget('visible')) ? ' has' : ''}" data-key="visible">◆</button></div>
    </div>
    <div class="sec"><h3>transformación</h3>${vec('posición', 'position')}${vec('rotación °', 'rotation', 1)}${vec('escala', 'scale')}</div>`;
    const m = this.mat();
    if (m) {
      html += `<div class="sec"><h3>material <span class="muted">${m.type}</span></h3>`;
      if (m.color) html += `<div class="row"><span class="lbl">color</span><input type="color" data-prop="material.color" value="${this.read('material.color')}"></div>`;
      if (m.emissive) html += `<div class="row"><span class="lbl">emisivo</span><input type="color" data-prop="material.emissive" value="${this.read('material.emissive')}"></div>` + num('intensidad', 'material.emissiveIntensity', 0.05);
      if ('roughness' in m) html += num('rugosidad', 'material.roughness');
      if ('metalness' in m) html += num('metal', 'material.metalness');
      html += num('opacidad', 'material.opacity');
      html += `<div class="row"><span class="lbl">transparente</span><input type="checkbox" data-prop="material.transparent" ${m.transparent ? 'checked' : ''}></div>`;
      if ('wireframe' in m) html += `<div class="row"><span class="lbl">wireframe</span><input type="checkbox" data-prop="material.wireframe" ${m.wireframe ? 'checked' : ''}><button class="key${this.hasKey(this.keyTarget('material.wireframe')) ? ' has' : ''}" data-key="material.wireframe">◆</button></div>`;
      html += '</div>';
    }
    if (o.geometry) {
      const g = o.geometry, n = g.attributes.position?.count ?? 0;
      html += `<div class="sec muted">geometría ${g.type} · ${n} vértices</div>`;
    }
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
    el.querySelector('[data-act=reset]').onclick = () => { this.ctx.resetOverride(o); this.render(); };
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
