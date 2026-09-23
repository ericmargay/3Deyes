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
  return { overrides: {}, added: [], settings: {}, timeline: { duration: 60, loop: true, bpm: 120, autoplay: true, tracks: [], cues: [] }, rules: [], presets: {} };
}

/** Primitivas que se pueden agregar desde el editor (como en Spline). */
export const PRIMITIVES = {
  cubo: () => new THREE.BoxGeometry(1, 1, 1),
  esfera: () => new THREE.SphereGeometry(0.6, 32, 24),
  cilindro: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  toro: () => new THREE.TorusGeometry(0.6, 0.2, 16, 48),
  cono: () => new THREE.ConeGeometry(0.6, 1.2, 32),
  piramide: () => new THREE.ConeGeometry(0.7, 1.2, 4),
  icosaedro: () => new THREE.IcosahedronGeometry(0.7, 0),
  dodecaedro: () => new THREE.DodecahedronGeometry(0.7, 0),
  'nudo tórico': () => new THREE.TorusKnotGeometry(0.5, 0.16, 120, 16),
  plano: () => new THREE.PlaneGeometry(2, 2),
  cápsula: () => new THREE.CapsuleGeometry(0.4, 0.8, 8, 16),
};
export const LIGHTS = {
  'luz puntual': () => new THREE.PointLight(0xffffff, 30, 0, 1.5),
  'luz direccional': () => { const l = new THREE.DirectionalLight(0xffffff, 2); l.castShadow = true; return l; },
  'luz foco': () => { const l = new THREE.SpotLight(0xffffff, 60, 0, Math.PI / 6, 0.4, 1.5); l.castShadow = true; return l; },
  'luz ambiente': () => new THREE.AmbientLight(0xffffff, 0.5),
};
export const MATERIAL_TYPES = ['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial', 'MeshToonMaterial', 'MeshLambertMaterial'];

const textureCache = new Map();
export function textureFor(assets, id) {
  if (!id || !assets?.[id]) return null;
  if (!textureCache.has(id)) {
    const t = new THREE.TextureLoader().load(assets[id]);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    textureCache.set(id, t);
  }
  return textureCache.get(id);
}

/** Crea un objeto agregado desde su descripción { id, kind, type, name }. */
export function createAdded(desc) {
  let obj;
  if (desc.kind === 'light') { obj = (LIGHTS[desc.type] || LIGHTS['luz puntual'])(); }
  else if (desc.kind === 'text') {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.font = 'bold 160px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(desc.text || 'texto', 512, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    obj = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }));
  } else {
    const geo = (PRIMITIVES[desc.type] || PRIMITIVES.cubo)();
    obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xff6fa5, roughness: 0.5, metalness: 0.1 }));
    obj.castShadow = true; obj.receiveShadow = true;
  }
  obj.name = desc.name;
  obj.userData.added = desc.id;
  if (desc.position) obj.position.fromArray(desc.position);
  return obj;
}

/** Instancia (o reinstancia) los objetos agregados de una escena bajo la raíz. */
export function syncAdded(root, added = []) {
  const existing = new Map();
  root.traverse((o) => { if (o.userData.added) existing.set(o.userData.added, o); });
  for (const desc of added) if (!existing.has(desc.id)) root.add(createAdded(desc));
  for (const [id, o] of existing) if (!added.find((d) => d.id === id)) { o.parent?.remove(o); o.geometry?.dispose?.(); }
}

/** Ajustes de escena: fondo, niebla. */
export function applySettings(root, s = {}) {
  if (s.background !== undefined) { if (s.background === null) root.background = null; else if (!(root.background instanceof THREE.Color)) root.background = new THREE.Color(s.background); else root.background.set(s.background); }
  if (s.fogDensity !== undefined) {
    if (s.fogDensity > 0) { if (!root.fog || !root.fog.isFogExp2) root.fog = new THREE.FogExp2(s.fogColor || (root.background?.getHex?.() ?? 0x000000), s.fogDensity); root.fog.density = s.fogDensity; if (s.fogColor) root.fog.color.set(s.fogColor); }
    else root.fog = null;
  }
}

export class Project {
  constructor(data = null) {
    this.data = data || { version: 1, scenes: {} };
  }

  scene(key) {
    if (!this.data.scenes[key]) this.data.scenes[key] = emptyScene();
    const s = this.data.scenes[key];
    s.overrides ??= {}; s.rules ??= []; s.presets ??= {}; s.added ??= []; s.settings ??= {};
    this.data.assets ??= {};
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
    for (const k of ['emissiveIntensity', 'roughness', 'metalness', 'opacity', 'wireframe', 'transparent', 'flatShading', 'side', 'clearcoat', 'transmission', 'ior']) if (k in m) o.material[k] = m[k];
    o.material.type = m.type;
    if (m.userData.mapId) o.material.map = m.userData.mapId;
    if (m.map?.repeat) o.material.repeat = m.map.repeat.x;
  }
  o.castShadow = obj.castShadow; o.receiveShadow = obj.receiveShadow;
  if (obj.isLight) { o.light = { intensity: obj.intensity, color: '#' + obj.color.getHexString() }; if ('distance' in obj) o.light.distance = obj.distance; if ('angle' in obj) o.light.angle = obj.angle; }
  return o;
}

export function applyOverride(obj, ov, assets = null) {
  if (!obj || !ov) return;
  if (ov.castShadow !== undefined) obj.castShadow = ov.castShadow;
  if (ov.receiveShadow !== undefined) obj.receiveShadow = ov.receiveShadow;
  if (ov.light && obj.isLight) { obj.intensity = ov.light.intensity; obj.color.set(ov.light.color); if (ov.light.distance !== undefined && 'distance' in obj) obj.distance = ov.light.distance; if (ov.light.angle !== undefined && 'angle' in obj) obj.angle = ov.light.angle; }
  if (ov.material?.type && obj.material && !Array.isArray(obj.material) && obj.material.type !== ov.material.type && THREE[ov.material.type]) {
    const old = obj.material; const m = new THREE[ov.material.type]();
    if (m.color && old.color) m.color.copy(old.color); if (m.map !== undefined) m.map = old.map; m.transparent = old.transparent; m.opacity = old.opacity;
    obj.material = m;
  }
  if (ov.position) obj.position.fromArray(ov.position);
  if (ov.rotation) obj.rotation.set(ov.rotation[0], ov.rotation[1], ov.rotation[2]);
  if (ov.scale) obj.scale.fromArray(ov.scale);
  if (ov.visible !== undefined) obj.visible = ov.visible;
  const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  if (m && ov.material) {
    for (const [k, v] of Object.entries(ov.material)) {
      if (k === 'type' || k === 'repeat') continue;
      if (k === 'map') { const t = textureFor(assets, v); if (t) { m.map = t; m.userData.mapId = v; if (ov.material.repeat) t.repeat.set(ov.material.repeat, ov.material.repeat); } else if (v === null) { m.map = null; delete m.userData.mapId; } }
      else if ((k === 'color' || k === 'emissive') && m[k]) m[k].set(v);
      else if (k in m) m[k] = v;
    }
    m.needsUpdate = true;
  }
}

export function applyOverrides(root, overrides, assets = null) {
  for (const [path, ov] of Object.entries(overrides || {})) applyOverride(findByPath(root, path), ov, assets);
}

/** Todo lo que el proyecto guarda para una escena, en orden. */
export function applySceneProject(root, ps, assets) {
  nameObjects(root);
  syncAdded(root, ps.added);
  applySettings(root, ps.settings);
  applyOverrides(root, ps.overrides, assets);
}
