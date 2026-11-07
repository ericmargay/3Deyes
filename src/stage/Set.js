import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Person } from '../calib/Person.js';

/**
 * El set físico (sin luces): un predio exterior de noche, con el muro del
 * mural al fondo, dos pabellones de chapa y hormigón enfrentados (cables
 * colgando, cajas, carreteles, tambores), un truss y el cielo. Todo con
 * texturas procedurales PBR. Si existe `public/modelos/escenario.glb`
 * (un escaneo de Sketchfab, por ejemplo) se carga en lugar de los pabellones.
 */

// ---------- texturas procedurales ----------
function octaveNoise(size) {
  const octs = [[6, 1], [12, 0.55], [24, 0.3], [48, 0.18], [96, 0.1], [192, 0.06]].map(([s, w]) => { const g = new Float32Array(s * s); for (let i = 0; i < g.length; i++) g[i] = Math.random(); return { s, w, g }; });
  return (x, y) => {
    let v = 0, tot = 0;
    for (const o of octs) {
      const fx = (x / size) * o.s, fy = (y / size) * o.s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const g = (i, j) => o.g[(((j % o.s) + o.s) % o.s) * o.s + (((i % o.s) + o.s) % o.s)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      v += ((g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy) * o.w; tot += o.w;
    }
    return v / tot;
  };
}
export function canvasTex(size, fn, srgb = false) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size), d = img.data, n = octaveNoise(size), n2 = octaveNoise(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const [r, g, b] = fn(n(x, y), n2(x, y), x, y, size); const i = (y * size + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Mapa de normales a partir de un campo de altura. */
export function normalTex(size, hfn, strength = 2) {
  const h = new Float32Array(size * size); const n = octaveNoise(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = hfn(n(x, y), x, y, size);
  return canvasTex(size, (_, __, x, y) => {
    const H = (i, j) => h[(((j % size) + size) % size) * size + (((i % size) + size) % size)];
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const v = new THREE.Vector3(-dx, -dy, 1).normalize();
    return [(v.x * 0.5 + 0.5) * 255, (v.y * 0.5 + 0.5) * 255, (v.z * 0.5 + 0.5) * 255];
  });
}

export function makeMaterials() {
  const concreteMap = canvasTex(512, (n, m) => { const v = 70 + n * 90 + (m - 0.5) * 30; return [v, v * 0.97, v * 0.92]; }, true);
  const concreteRough = canvasTex(256, (n) => { const v = 150 + n * 90; return [v, v, v]; });
  const concreteNrm = normalTex(256, (n) => n * 2.5, 1.5);
  const rustMap = canvasTex(512, (n, m) => { const r = n > 0.55 ? 1 : 0; const base = [60 + m * 40, 48 + m * 30, 42 + m * 25], rust = [150 + n * 80, 70 + n * 40, 30 + n * 20]; return [base[0] * (1 - r) + rust[0] * r, base[1] * (1 - r) + rust[1] * r, base[2] * (1 - r) + rust[2] * r]; }, true);
  const rustRough = canvasTex(256, (n) => { const v = 120 + n * 120; return [v, v, v]; });
  const corrNrm = normalTex(256, (n, x, y, size) => Math.sin((x / size) * Math.PI * 2 * 24) * 1.2 + n * 0.3, 1.2);
  const woodMap = canvasTex(256, (n, m, x, y, size) => { const g = 0.5 + 0.5 * Math.sin((y / size) * 60 + n * 8); const v = 90 + g * 50 + m * 30; return [v, v * 0.78, v * 0.55]; }, true);
  const rep = (t, r) => { t.repeat.set(r, r); return t; };
  return {
    concrete: new THREE.MeshStandardMaterial({ map: rep(concreteMap, 2), roughnessMap: rep(concreteRough, 2), normalMap: rep(concreteNrm, 2), roughness: 0.95, metalness: 0.02 }),
    rust: new THREE.MeshStandardMaterial({ map: rustMap, roughnessMap: rustRough, roughness: 0.75, metalness: 0.55 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.4, metalness: 0.9 }),
    corrugated: new THREE.MeshStandardMaterial({ color: 0x4a4c50, normalMap: rep(corrNrm, 3), roughness: 0.55, metalness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.9, metalness: 0 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.45, metalness: 0.1 }),
    cableRed: new THREE.MeshStandardMaterial({ color: 0x8c1a16, roughness: 0.5, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.95 }),
    silhouette: new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 }),
  };
}

// ---------- cielo ----------
const skyVert = /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const skyFrag = /* glsl */ `
  uniform vec3 horizon, zenith, flashColor; uniform float flash, time, bright;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.05, 1.0);
    float band = exp(-h * 4.5);                    // resplandor del horizonte
    vec2 uv = vec2(atan(d.z, d.x) * 2.0, h * 6.0);
    float cl = noise(uv * 1.5 + vec2(time * 0.01, 0.0)) * 0.6 + noise(uv * 4.0 - vec2(0.0, time * 0.02)) * 0.4;
    vec3 col = mix(zenith, horizon, band) * (0.85 + 0.3 * cl);
    col += horizon * 0.5 * pow(band, 2.0);
    col = mix(col, flashColor * (1.0 + 2.0 * band), flash * (0.55 + 0.45 * band));
    col *= bright;
    // estrellas tenues arriba
    float st = step(0.9975, hash(floor(d.xz * 400.0 / max(0.2, d.y)))) * smoothstep(0.15, 0.6, d.y) * (1.0 - flash);
    col += vec3(st) * 0.35;
    gl_FragColor = vec4(col, 1.0);
  }
`;
export class Sky extends THREE.Mesh {
  constructor() {
    super(new THREE.SphereGeometry(300, 48, 24), new THREE.ShaderMaterial({ uniforms: { horizon: { value: new THREE.Color(0.9, 0.15, 0.05) }, zenith: { value: new THREE.Color(0.02, 0.0, 0.01) }, flashColor: { value: new THREE.Color(1, 0.55, 0.15) }, flash: { value: 0 }, time: { value: 0 }, bright: { value: 1 } }, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false }));
    this.name = 'cielo'; this.renderOrder = -100; this.frustumCulled = false; this.userData.helper = true;
  }
  set(horizon, zenith, flashColor, flash, time, bright) { const u = this.material.uniforms; u.horizon.value.copy(horizon); u.zenith.value.copy(zenith); u.flashColor.value.copy(flashColor); u.flash.value = flash; u.time.value = time; u.bright.value = bright; }
}

// ---------- piezas ----------
function box(w, h, d, mat, x, y, z, ry = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; return m; }
function cyl(r0, r1, h, mat, x, y, z, seg = 16) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; return m; }

/** Cable colgante entre dos puntos con comba, que puede seguir hasta el piso. */
export function cable(points, mat, radius = 0.02) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.3);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 6, false), mat); m.name = 'cable'; m.castShadow = true; return m;
}

/**
 * Pabellón: cuatro columnas de hormigón, losa / chapa inclinada, vigas,
 * cables que cuelgan, cajas, carretel y tambores. `side` = -1 / 1.
 * Ocupa |x| ∈ [4.6, 9.6], z ∈ [1, 7]; techo a 3.4 m.
 */
export function buildShelter(side, M, rnd = Math.random) {
  const g = new THREE.Group(); g.name = side < 0 ? 'pabellón izquierdo' : 'pabellón derecho';
  const x0 = side * 7.1, w = 5, d = 6, zc = 4;
  for (const [dx, dz] of [[-2.2, -2.7], [2.2, -2.7], [-2.2, 2.7], [2.2, 2.7]]) g.add(box(0.38, 3.3, 0.38, M.concrete, x0 + dx, 1.65, zc + dz));
  const roof = new THREE.Group(); roof.position.set(x0, 3.4, zc); roof.rotation.z = side * 0.06; roof.rotation.x = 0.03;
  roof.add(box(w + 0.6, 0.12, d + 0.6, M.corrugated, 0, 0.1, 0));
  for (let i = -2; i <= 2; i++) roof.add(box(0.12, 0.2, d + 0.4, M.rust, i * 1.2, -0.08, 0));
  for (let i = -2; i <= 2; i++) roof.add(box(w + 0.4, 0.14, 0.12, M.rust, 0, -0.12, i * 1.4));
  roof.add(box(w + 0.7, 0.05, 0.3, M.rust, 0, 0.18, -d / 2 - 0.2));   // borde
  g.add(roof);
  // cables que cuelgan de las vigas y serpentean por el piso
  const inner = side < 0 ? 1 : -1;
  for (let i = 0; i < 9; i++) {
    const a = [x0 + (rnd() - 0.5) * 4.6, 3.2, zc + (rnd() - 0.5) * 5.6];
    const mid = [a[0] + (rnd() - 0.5) * 1.2, 1.2 + rnd() * 1.2, a[2] + (rnd() - 0.5) * 1.2];
    const floor = [x0 + inner * (2.6 + rnd() * 3.5), 0.03, zc + (rnd() - 0.5) * 7];
    const floor2 = [floor[0] + inner * (1 + rnd() * 3), 0.03, floor[2] + (rnd() - 0.5) * 5];
    g.add(cable([a, mid, floor, floor2], i % 3 === 0 ? M.cableRed : M.cable, 0.014 + rnd() * 0.016));
  }
  // cables cruzados entre vigas
  for (let i = 0; i < 5; i++) g.add(cable([[x0 - 2.3, 3.1, zc - 2.5 + i * 1.2], [x0 + (rnd() - 0.5), 2.3 + rnd() * 0.6, zc - 2.3 + i * 1.2], [x0 + 2.3, 3.1, zc - 2.4 + i * 1.2]], M.cable, 0.012));
  // cajas, carretel, tambores
  for (let i = 0; i < 6; i++) { const s = 0.45 + rnd() * 0.5; g.add(box(s, s * 0.8, s, M.wood, x0 + (rnd() - 0.5) * 3.6, s * 0.4, zc + (rnd() - 0.5) * 4.5, rnd() * 1.2)); }
  g.add(box(0.9, 0.7, 0.9, M.wood, x0 + 1.2, 0.35, zc + 2.2, 0.3)); g.add(box(0.8, 0.6, 0.8, M.wood, x0 + 1.25, 1.0, zc + 2.25, 0.5));
  const spool = new THREE.Group(); spool.position.set(x0 - 1.4, 0.55, zc - 2.0); spool.rotation.z = Math.PI / 2;
  spool.add(cyl(0.55, 0.55, 0.08, M.wood, 0, 0.3, 0, 24), cyl(0.55, 0.55, 0.08, M.wood, 0, -0.3, 0, 24), cyl(0.2, 0.2, 0.6, M.cableRed, 0, 0, 0, 16)); g.add(spool);
  for (let i = 0; i < 3; i++) g.add(cyl(0.3, 0.3, 0.88, M.rust, x0 + inner * -1.8 + i * 0.65, 0.44, zc + 2.6 + (i % 2) * 0.3, 20));
  return g;
}

/** Muro del mural (pared exenta de hormigón) con marco; la pantalla la agrega la escena. */
export function buildMuralWall(M, w = 10, h = 5.6, bottom = 0.9, z = -1) {
  const g = new THREE.Group(); g.name = 'muro del mural';
  g.add(box(w + 3, h + bottom + 0.8, 0.6, M.concrete, 0, (h + bottom + 0.8) / 2, z - 0.35));
  for (const sd of [-1, 1]) g.add(box(0.6, h + bottom + 1.2, 1.2, M.concrete, sd * (w / 2 + 1.8), (h + bottom + 1.2) / 2, z - 0.3));   // contrafuertes
  const frame = box(w + 0.25, h + 0.25, 0.08, M.dark, 0, bottom + h / 2, z - 0.02); frame.name = 'marco'; g.add(frame);
  return g;
}

/** Truss triangular horizontal. */
export function buildTruss(M, len, y, z, x = 0) {
  const g = new THREE.Group(); g.name = 'truss';
  for (const [dy, dz] of [[0, -0.22], [0, 0.22], [0.38, 0]]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), M.metal); m.rotation.z = Math.PI / 2; m.position.set(x, y + dy, z + dz); g.add(m); }
  for (let xx = -len / 2; xx <= len / 2; xx += 0.5) for (const [a, b] of [[[0, -0.22], [0.38, 0]], [[0, 0.22], [0.38, 0]], [[0, -0.22], [0, 0.22]]]) {
    const p0 = new THREE.Vector3(x + xx, y + a[0], z + a[1]), p1 = new THREE.Vector3(x + xx + 0.25, y + b[0], z + b[1]);
    const dd = p1.clone().sub(p0), m = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, dd.length(), 5), M.metal);
    m.position.copy(p0).add(dd.multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dd.normalize()); g.add(m);
  }
  // patas
  for (const sd of [-1, 1]) g.add(cyl(0.04, 0.04, y, M.metal, x + sd * (len / 2 - 0.2), y / 2, z, 8));
  return g;
}

/** Siluetas (gente parada): sobre los techos y a los costados, como en el video. */
export function buildSilhouettes(M, spots) {
  const g = new THREE.Group(); g.name = 'siluetas';
  for (const [x, y, z, h] of spots) { const p = new Person(0x08080a); p.setHeight(h ?? 1.75); p.group.position.set(x, y, z); p.group.rotation.y = Math.random() * 6.28; p.group.traverse((o) => { if (o.isMesh) o.material = M.silhouette; }); g.add(p.group); }
  return g;
}

/** Carga un set escaneado (GLB) si existe; devuelve el grupo o null. */
export async function loadSetGLB(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok || !(res.headers.get('content-type') || '').match(/octet|gltf|model/)) return null;
    const gltf = await new GLTFLoader().loadAsync(url);
    const g = gltf.scene; g.name = 'set (glb)';
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  } catch (_) { return null; }
}
