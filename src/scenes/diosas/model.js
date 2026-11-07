import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EYE } from './anatomy.js';

/**
 * Modelo GLB externo (provisorio) en lugar de la anatomía procedural.
 *
 *  - Se lee de public/modelos/diosa.glb (carpeta ignorada por git: no se
 *    publica) o de un archivo elegido con diosas.modelo.cargar (queda guardado
 *    en IndexedDB del navegador).
 *  - El esqueleto se detecta por los pesos de piel, no por los nombres (muchos
 *    modelos de Sketchfab traen nombres de huesos rotos): el hueso que más mueve
 *    la malla de la cara es la cabeza, su padre el cuello, los que mueven las
 *    mallas de ojos son los ojos. Los brazos en pose T se detectan por
 *    geometría (huesos horizontales a la altura de los hombros) y se bajan.
 *  - Se escala y se ubica para que los ojos queden donde estarían los de la
 *    diosa procedural: el estéreo, el halo y la mirada siguen igual.
 *  - Los materiales se re-iluminan con la paleta (diosas.modelo.neon).
 */

// ---------- materiales specular-glossiness (los exporta Sketchfab; three los dejó de leer) ----------
class SpecGlossPlugin {
  constructor(parser) { this.parser = parser; this.name = 'KHR_materials_pbrSpecularGlossiness'; }
  extendMaterialParams(index, params) {
    const ext = this.parser.json.materials[index].extensions?.[this.name];
    if (!ext) return Promise.resolve();
    const pending = [];
    if (ext.diffuseFactor) { params.color = new THREE.Color().setRGB(ext.diffuseFactor[0], ext.diffuseFactor[1], ext.diffuseFactor[2], THREE.LinearSRGBColorSpace); params.opacity = ext.diffuseFactor[3]; }
    if (ext.diffuseTexture) pending.push(this.parser.assignTexture(params, 'map', ext.diffuseTexture, THREE.SRGBColorSpace));
    params.metalness = 0;
    params.roughness = 1 - (ext.glossinessFactor ?? 0.5) * 0.8;
    return Promise.all(pending);
  }
}

// ---------- guardado del archivo elegido (IndexedDB) ----------
const DB = '3deyes', STORE = 'archivos', KEY = 'diosas-modelo';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function storeModelFile(buffer, name) {
  const db = await idb();
  await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put({ buffer, name }, KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function readStoredModel() {
  try {
    const db = await idb();
    return await new Promise((res) => { const tx = db.transaction(STORE, 'readonly'); const q = tx.objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
  } catch (_) { return null; }
}
export async function forgetStoredModel() {
  try { const db = await idb(); await new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(KEY); tx.oncomplete = res; tx.onerror = res; }); } catch (_) { /* */ }
}

/** Abre un selector de archivo (.glb) y devuelve { buffer, name } o null. Necesita un gesto del usuario. */
export function pickModelFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.glb,model/gltf-binary';
    input.onchange = async () => { const f = input.files[0]; resolve(f ? { buffer: await f.arrayBuffer(), name: f.name } : null); };
    input.click();
  });
}

// ---------- carga y análisis ----------
/** source: URL o ArrayBuffer. Devuelve la plantilla { scene, rig, info } o null si no hay archivo. */
export async function loadModelTemplate(source) {
  const loader = new GLTFLoader();
  loader.register((parser) => new SpecGlossPlugin(parser));
  let gltf;
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok || !(res.headers.get('content-type') || '').match(/octet|gltf|model/)) return null;
    gltf = await loader.parseAsync(await res.arrayBuffer(), '');
  } else gltf = await loader.parseAsync(source, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const rig = analyzeRig(scene);
  const extras = gltf.asset?.extras || {};
  const info = { title: extras.title || 'modelo', author: extras.author || '', license: extras.license || '', source: extras.source || '' };
  return { scene, rig, info };
}

function dominantBones(mesh, filter) {
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, pos = mesh.geometry.attributes.position;
  if (!si || !sw) return new Map();
  const acc = new Map(), v = new THREE.Vector3();
  for (let i = 0; i < si.count; i++) {
    if (filter) { mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld); if (!filter(v)) continue; }
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k); if (w <= 0) continue;
      const b = si.getComponent(i, k);
      acc.set(b, (acc.get(b) || 0) + w);
    }
  }
  return acc;
}
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

function analyzeRig(scene) {
  const meshes = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) return { ok: false, reason: 'sin esqueleto' };
  const bones = meshes[0].skeleton.bones;
  const wp = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
  const box = new THREE.Box3().setFromObject(scene);
  const H = box.max.y - box.min.y;
  const name = (m) => `${m.name} ${Array.isArray(m.material) ? '' : m.material?.name || ''}`.toLowerCase();

  // cabeza: el hueso que más pesa en la malla de la cara / cabeza
  const faceMesh = meshes.find((m) => /head|face|facial|kao/.test(name(m))) || null;
  let head = faceMesh ? top(dominantBones(faceMesh)) : undefined;
  if (head === undefined) {
    // sin nombres: el hueso con más hijos en el 20 % superior
    let best = -1;
    bones.forEach((b, i) => { if (wp[i].y > box.max.y - H * 0.2 && b.children.length > best) { best = b.children.length; head = i; } });
  }
  const neck = bones.indexOf(bones[head]?.parent);

  // ojos: huesos dominantes de las mallas de ojos, separados por lado
  const eyeMeshes = meshes.filter((m) => /eye|hitomi|me_/.test(name(m)));
  const eyes = [];
  for (const side of [1, -1]) {
    const acc = new Map();
    for (const m of eyeMeshes) for (const [b, w] of dominantBones(m, (v) => v.x * side > 0)) acc.set(b, (acc.get(b) || 0) + w);
    const b = top(acc);
    if (b !== undefined && b !== head && !eyes.some((e) => e.bone === b)) eyes.push({ bone: b, side });
  }

  // brazos en pose T: primer hueso largo y horizontal de cada lado a la altura de los hombros
  const arms = [];
  const neckY = neck >= 0 ? wp[neck].y : box.max.y - H * 0.2;
  for (const side of [1, -1]) {
    let pick = -1, pickX = Infinity;
    bones.forEach((b, i) => {
      const c = b.children.find((x) => x.isBone); if (!c) return;
      const ci = bones.indexOf(c); if (ci < 0) return;
      const d = wp[ci].clone().sub(wp[i]);
      const x = wp[i].x * side;
      if (x <= H * 0.01 || Math.abs(wp[i].y - neckY) > H * 0.12) return;
      if (d.x * side < H * 0.06 || Math.abs(d.x) < Math.abs(d.y) * 1.5) return;
      if (x < pickX) { pickX = x; pick = i; }
    });
    if (pick >= 0) {
      const c = bones[pick].children.find((x) => x.isBone), d = wp[bones.indexOf(c)].clone().sub(wp[pick]);
      arms.push({ bone: pick, side, angle0: Math.atan2(-d.y, Math.abs(d.x)) });   // ya baja este ángulo (pose A)
    }
  }

  // pelo: huesos con nombre de pelo / cola (si los nombres se leen) para el balanceo
  const hair = [];
  bones.forEach((b, i) => { if (/hair|tail|kami|髪/i.test(b.name)) hair.push(i); });

  // medidas para alinear: ojos y alto de la cabeza (vértices que mueve la cabeza)
  const eyeMid = eyes.length ? eyes.reduce((a, e) => a.add(wp[e.bone]), new THREE.Vector3()).multiplyScalar(1 / eyes.length) : wp[head].clone().add(new THREE.Vector3(0, H * 0.03, H * 0.03));
  let headTop = -Infinity, headBottom = Infinity, headFront = -Infinity;
  for (const m of meshes) {
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, pos = m.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 2) {
      let best = 0, bb = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bb = si.getComponent(i, k); } }
      if (bb !== head) continue;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      headTop = Math.max(headTop, v.y); headBottom = Math.min(headBottom, v.y); headFront = Math.max(headFront, v.z);
    }
  }
  return { ok: head !== undefined, head, neck, eyes, arms, hair, eyeMid, headTop, headBottom, headFront, height: H, boneCount: bones.length };
}

// ---------- re-iluminación neón (se inyecta en los materiales del modelo) ----------
function neonPatch(material, U, F, E, isEye) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      cShadow: U.cShadow, cSkin: U.cSkin, cKey: U.cKey, cRim: U.cRim, uKeyDir: U.uKeyDir, uFillDir: U.uFillDir, uRimDir: U.uRimDir,
      uRimAmt: U.uRimAmt, uPulse: U.uPulse, uFade: F.uFade, uNeon: E.uNeon, uIris: E.uIris, uEyeGlow: E.uEyeGlow,
    });
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform vec3 cShadow, cSkin, cKey, cRim, uKeyDir, uFillDir, uRimDir, uIris;
        uniform float uRimAmt, uPulse, uFade, uNeon, uEyeGlow;
        void main() {`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 nV = normalize(normal), vV = normalize(vViewPosition);
          vec3 kV = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
          vec3 fV = normalize((viewMatrix * vec4(uFillDir, 0.0)).xyz);
          vec3 rV = normalize((viewMatrix * vec4(uRimDir, 0.0)).xyz);
          float key = smoothstep(0.1, 0.9, dot(nV, kV)), fill = smoothstep(-0.4, 0.8, dot(nV, fV));
          vec3 alb = diffuseColor.rgb;
          float lum = dot(alb, vec3(0.299, 0.587, 0.114));
          vec3 ramp = mix(cShadow * 0.6, cSkin * 0.85, fill * 0.85 + 0.1);
          ramp = mix(ramp, cKey * 0.9, key * 0.8);
          vec3 neon = ramp * (0.25 + 1.3 * lum) + alb * 0.12 * (0.4 + key);
          ${isEye ? `float sat = max(alb.r, max(alb.g, alb.b)) - min(alb.r, min(alb.g, alb.b));
          neon = mix(neon, uIris * (0.25 + 1.2 * lum) * (0.5 + 0.5 * uEyeGlow) * (0.9 + 0.3 * uPulse), 0.9 * smoothstep(0.08, 0.3, sat));` : ''}
          float rim = pow(1.0 - abs(dot(nV, vV)), 3.0);
          neon += cRim * rim * uRimAmt * 0.6 * (0.35 + 0.65 * smoothstep(-0.3, 0.6, dot(nV, rV)));
          outgoingLight = mix(outgoingLight, neon + totalEmissiveRadiance, uNeon) * uFade;
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `diosas-neon-${isEye ? 'ojo' : 'piel'}`;
  material.needsUpdate = true;
}

/**
 * Instancia del modelo para una figura: clona la plantilla (con su esqueleto),
 * clona y parchea los materiales, y ubica todo en coordenadas de la figura.
 */
export class ModelInstance {
  constructor(template, U, F) {
    this.t = template;
    this.E = { uNeon: { value: 0.75 }, uIris: { value: new THREE.Color(1, 0.7, 0.2) }, uEyeGlow: { value: 1 } };
    this.root = new THREE.Group(); this.root.name = `modelo (${template.info.title})`;
    this.scene = cloneSkinned(template.scene);
    const matCache = new Map();
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const isEye = /eye|hitomi/.test(`${o.name} ${o.material?.name}`.toLowerCase());
      const fix = (m) => {
        if (matCache.has(m)) return matCache.get(m);
        const c = m.clone(); neonPatch(c, U, F, this.E, isEye); matCache.set(m, c); return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    });
    this.root.add(this.scene);
    const meshes = []; this.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    this.bones = meshes[0]?.skeleton.bones || [];
    this.rest = this.bones.map((b) => b.quaternion.clone());
    this.sway = this.t.rig.hair.map((i) => ({ i, ph: Math.random() * 6.28 }));
    this.fit(1, 0, 0);
  }

  /** Escala y posición: ojos del modelo sobre los ojos de la diosa procedural. */
  fit(scaleMul, dy, dz) {
    const r = this.t.rig;
    const headH = Math.max(1e-3, r.headTop - r.headBottom);
    const s = (2.25 / headH) * scaleMul;
    this.scale = s;
    this.root.scale.setScalar(s);
    this.root.position.set(-r.eyeMid.x * s, EYE.y - r.eyeMid.y * s + dy, EYE.z + 0.12 - r.eyeMid.z * s + dz);
    this.basePos = this.root.position.clone();
  }

  /** Aplica rotación (en espacio de la figura) a un hueso alrededor de su pivote. */
  rotateBone(i, qFig, qRootWorld) {
    if (i === undefined || i < 0) return;
    const b = this.bones[i];
    const parentQ = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const qW = qRootWorld.clone().multiply(qFig).multiply(qRootWorld.clone().invert());
    b.quaternion.copy(parentQ.clone().invert().multiply(qW).multiply(parentQ).multiply(this.rest[i]));
    b.updateMatrixWorld(true);
  }

  /**
   * pose: Euler de la cabeza (en la figura); gazeTarget en mundo; s: estado
   * (brazos en grados, cantidad de ojos, balanceo del pelo, tiempo).
   */
  update(figureRoot, headEuler, gazeTarget, s) {
    const r = this.t.rig;
    for (const [i, q] of this.rest.entries()) this.bones[i].quaternion.copy(q);
    this.root.updateMatrixWorld(true);
    const qRoot = figureRoot.getWorldQuaternion(new THREE.Quaternion());
    // brazos abajo
    for (const a of r.arms) this.rotateBone(a.bone, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a.side * Math.max(0, THREE.MathUtils.degToRad(s.arms) - (a.angle0 || 0))), qRoot);
    // cuello 35 % y cabeza 65 % de la pose
    const qPose = new THREE.Quaternion().setFromEuler(headEuler);
    const qNeck = new THREE.Quaternion().slerp(qPose, 0.35), qHead = new THREE.Quaternion().slerp(qPose, 0.65);
    this.rotateBone(r.neck, qNeck, qRoot);
    this.rotateBone(r.head, qHead, qRoot);
    // ojos hacia el objetivo, con límite (el frente de la cabeza ya girada es +z del modelo)
    if (r.eyes.length && s.eyeAmount > 0) {
      const qHeadTotal = qRoot.clone().multiply(qHead).multiply(qNeck);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(qHeadTotal);
      const up = new THREE.Vector3(0, 1, 0.25).normalize().applyQuaternion(qHeadTotal);
      for (const e of r.eyes) {
        const p = this.bones[e.bone].getWorldPosition(new THREE.Vector3());
        const dir = gazeTarget.clone().sub(p).normalize();
        if (s.gazeUp > 0) dir.lerp(up, Math.min(1, s.gazeUp)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(fwd, dir);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
        const lim = 0.4 * s.eyeAmount;
        const qe = new THREE.Quaternion().slerp(q, ang > 1e-4 ? Math.min(1, lim / ang) : 0);
        const b = this.bones[e.bone];
        const parentQ = b.parent.getWorldQuaternion(new THREE.Quaternion());
        b.quaternion.copy(parentQ.clone().invert().multiply(qe).multiply(parentQ).multiply(this.rest[e.bone]));
        b.updateMatrixWorld(true);
      }
    }
    // pelo: balanceo suave
    if (s.sway > 0) for (const h of this.sway) {
      const b = this.bones[h.i];
      b.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(s.time * 1.1 + h.ph) * 0.05 * s.sway, 0, Math.sin(s.time * 0.8 + h.ph * 2) * 0.04 * s.sway)));
    }
  }

}

