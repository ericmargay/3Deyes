/**
 * Proyecto: todo lo que el editor construye sobre las escenas (plantillas).
 *
 * {
 *   version, scenes: {
 *     [sceneKey]: {
 *       overrides: { [objPath]: { position, rotation, scale, visible, material: {...} } },
 *       timeline: { duration, loop, bpm, autoplay, tracks: [{ target, keys: [{ t, v, e }] }], cues: [{ t, action }] },
 *       rules: [ { id, enabled, on: {...}, do: {...} } ],
 *       presets: { [name]: { params } },
 *     }
 *   }
 * }
 *
 * target de una pista:  "param:room.hue"  |  "obj:deco/Mesh.2:position.y"  |  "obj:.../material.opacity"
 * Los objetos se identifican por su ruta de nombres desde la raíz de la escena.
 */
import * as THREE from 'three';

export const STORAGE_KEY = '3deyes.project';

export function emptyScene() {
  return { overrides: {}, timeline: { duration: 60, loop: true, bpm: 120, autoplay: true, tracks: [], cues: [] }, rules: [], presets: {} };
}

export class Project {
  constructor(data = null) {
    this.data = data || { version: 1, scenes: {} };
  }

  scene(key) {
    if (!this.data.scenes[key]) this.data.scenes[key] = emptyScene();
    const s = this.data.scenes[key];
    s.overrides ??= {}; s.rules ??= []; s.presets ??= {};
    s.timeline ??= emptyScene().timeline; s.timeline.tracks ??= []; s.timeline.cues ??= [];
    return s;
  }

  static load() {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return new Project(JSON.parse(s)); } catch (_) { /* */ }
    return new Project();
  }

  save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (_) { /* */ } }

  toJSON() { return this.data; }

  export() {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `3deyes-proyecto-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  }

  static importFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'application/json';
      input.onchange = async () => { try { resolve(new Project(JSON.parse(await input.files[0].text()))); } catch (_) { resolve(null); } };
      input.click();
    });
  }
}

// ---------- rutas de objetos ----------

/** Da nombres estables a los hijos sin nombre (tipo.índice) para poder referenciarlos. */
export function nameObjects(root) {
  root.traverse((o) => {
    if (o === root) return;
    if (!o.name) o.name = `${o.type}.${o.parent.children.indexOf(o)}`;
  });
}

export function pathOf(obj, root) {
  const parts = [];
  let o = obj;
  while (o && o !== root) { parts.unshift(o.name); o = o.parent; }
  return o === root ? parts.join('/') : null;
}

export function findByPath(root, path) {
  if (!path) return null;
  let o = root;
  for (const part of path.split('/')) {
    o = o.children.find((c) => c.name === part);
    if (!o) return null;
  }
  return o;
}

/** Lee o escribe una propiedad anidada ("position.y", "material.opacity", "visible"). */
export function getProp(obj, prop) {
  return prop.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setProp(obj, prop, value) {
  const parts = prop.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  if (target == null) return false;
  if (target[last] instanceof THREE.Color) { target[last].set(value); return true; }
  target[last] = value;
  if (last === 'color' || last === 'emissive') target.needsUpdate = true;
  return true;
}

// ---------- overrides ----------

export function captureOverride(obj) {
  const o = { position: obj.position.toArray(), rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z], scale: obj.scale.toArray(), visible: obj.visible };
  const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  if (m) {
    o.material = {};
    if (m.color) o.material.color = '#' + m.color.getHexString();
    if (m.emissive) o.material.emissive = '#' + m.emissive.getHexString();
    for (const k of ['emissiveIntensity', 'roughness', 'metalness', 'opacity', 'wireframe', 'transparent']) if (k in m) o.material[k] = m[k];
  }
  return o;
}

export function applyOverride(obj, ov) {
  if (!obj || !ov) return;
  if (ov.position) obj.position.fromArray(ov.position);
  if (ov.rotation) obj.rotation.set(ov.rotation[0], ov.rotation[1], ov.rotation[2]);
  if (ov.scale) obj.scale.fromArray(ov.scale);
  if (ov.visible !== undefined) obj.visible = ov.visible;
  const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  if (m && ov.material) {
    for (const [k, v] of Object.entries(ov.material)) {
      if ((k === 'color' || k === 'emissive') && m[k]) m[k].set(v);
      else if (k in m) m[k] = v;
    }
    m.needsUpdate = true;
  }
}

export function applyOverrides(root, overrides) {
  for (const [path, ov] of Object.entries(overrides || {})) applyOverride(findByPath(root, path), ov);
}
