import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { MusicScene } from './MusicScene.js';
import { Fluid } from '../../sim/Fluid.js';
import { canvasTex, normalTex } from '../../stage/Set.js';

/**
 * RORSCHACH: una lámina de cartulina colgada en una pared oscura, bajo un
 * spot de galería. La música deja caer tinta sobre el pliegue y la lámina se
 * cierra y se vuelve a abrir a tempo: la mancha sale siempre simétrica.
 *
 *   bombo      gota grande sobre el pliegue que se expande (prensado)
 *   bajo       la mancha se sigue abriendo mientras el bajo sostiene
 *   caja       salpicadura con gotitas que salen disparadas
 *   agudos     chorreado: la gota corre hacia abajo por la lámina
 *   platillos  rocío de puntitos
 *   notas      tinta de color a la altura de la nota (grave abajo)
 *   beat       la mancha respira (se abre y se recoge)
 *   compás     la lámina se pliega y se abre: al despegarse salen los
 *              dedos y ramificaciones típicas de la tinta
 *   sección    lámina nueva: la vieja se cae y deja ver la siguiente
 *
 * La tinta es un fluido viscoso (Navier–Stokes con simetría de espejo
 * exacta). Se dibuja como tinta de verdad sobre papel: absorbe la luz
 * (Beer–Lambert, las tintas se mezclan restando), borde duro rasgado por la
 * fibra del papel, anillo más oscuro en el borde, y mientras está fresca
 * brilla (capa de barniz). Modo neón: tinta fluorescente sobre cartulina
 * negra bajo luz negra.
 *
 * Interacción: arrastrar sobre la lámina pinta; clic deja una gota. El pad
 * Kaoss (Z) es un pincel de tinta.
 */
const W = 16, H = 11;
const absorb = (c) => c.map((v) => -Math.log(Math.max(0.02, v)));
const BLACK = absorb([0.012, 0.012, 0.016]);
const RED = absorb([0.86, 0.09, 0.11]);
const PASTELS = [[0.96, 0.58, 0.64], [0.99, 0.7, 0.4], [0.56, 0.7, 0.95], [0.6, 0.85, 0.6], [0.98, 0.88, 0.45], [0.78, 0.66, 0.96]].map(absorb);
const PAPER = { normal: [0.92, 0.9, 0.86], neon: [0.012, 0.01, 0.016] };
const FOLDS = { 'cada compás': 1, 'cada 2 compases': 2, 'cada 4 compases': 4, 'cada 8 compases': 8, 'sección': -1, nunca: 0 };
const easeIn = (x) => x * x * x, easeOut = (x) => 1 - Math.pow(1 - x, 3), smooth = (x) => x * x * (3 - 2 * x);

const inkPars = /* glsl */ `
  uniform sampler2D tInk; uniform vec2 inkTexel, uvMap, cardSize;
  uniform vec3 paper; uniform float neon, rimAmt, feather, relief, glow, bleed, wetGloss, paperBump, breathe, inkOpacity, inkFloor;
  varying vec2 vInkUv; varying vec3 vTanV, vBitV;
  float rh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm3(vec2 p) { return 0.5 * vn(p) + 0.3 * vn(p * 2.03 + 1.7) + 0.2 * vn(p * 4.11 - 2.3); }
  float rhoAt(vec2 uv) { return dot(texture2D(tInk, uv).rgb, vec3(1.0 / 3.0)); }
  vec3 inkBump(vec3 surfPos, vec3 n, vec2 dH) {
    vec3 sx = normalize(dFdx(surfPos)), sy = normalize(dFdy(surfPos));
    vec3 R1 = cross(sy, n), R2 = cross(n, sx);
    float det = dot(sx, R1);
    return normalize(abs(det) * n - sign(det) * (dH.x * R1 + dH.y * R2));
  }
`;
const inkMain = /* glsl */ `
  float inkWet = 0.0, inkCov = 0.0, paperH = 0.0; vec3 inkEmit = vec3(0.0); vec2 inkGrad = vec2(0.0);
  {
    vec2 P = vInkUv * cardSize;
    float grain = fbm3(P * 14.0);
    float fa = vn(mat2(0.83, -0.56, 0.56, 0.83) * P * vec2(70.0, 6.0));
    float fb = vn(mat2(-0.27, -0.96, 0.96, -0.27) * P * vec2(70.0, 6.0));
    float fibers = smoothstep(0.78, 0.97, max(fa, fb));
    paperH = grain * 0.6 + fibers * 0.4;
    // la fibra del papel desvía la tinta: borde rasgado
    vec2 jit = vec2(fbm3(P * 4.0 + 7.3), fbm3(P * 4.0 - 3.1)) - 0.5;
    vec2 uv = vInkUv + jit * inkTexel * feather * 6.0;
    vec4 I = texture2D(tInk, uv);
    float rho = dot(I.rgb, vec3(1.0 / 3.0));
    float edgeN = ((grain - 0.5) * 0.35 + fibers * 0.12) * feather;
    float th = breathe;   // el beat baja el umbral: la mancha se abre y se vuelve a recoger
    float cov = smoothstep(0.17 * th, 0.24 * th, rho + edgeN * min(rho * 3.0, 1.0));
    float halo = (1.0 - cov) * 0.05;                          // lo que no llega al umbral apenas tiñe
    float band = cov * (1.0 - smoothstep(0.3 * th, 0.9 * th, rho));   // anillo oscuro adentro del borde
    inkCov = cov;
    inkWet = clamp(I.a * 1.6, 0.0, 1.0) * cov;
    vec2 e = inkTexel * 1.5;
    float rl = smoothstep(0.12, 0.6, rhoAt(uv - vec2(e.x, 0.0))), rr = smoothstep(0.12, 0.6, rhoAt(uv + vec2(e.x, 0.0)));
    float rb = smoothstep(0.12, 0.6, rhoAt(uv - vec2(0.0, e.y))), rt = smoothstep(0.12, 0.6, rhoAt(uv + vec2(0.0, e.y)));
    inkGrad = vec2(rr - rl, rt - rb) / (2.0 * e * cardSize);
    vec3 pap = paper * (0.93 + 0.1 * grain - 0.05 * fibers);
    if (neon > 0.5) {
      diffuseColor.rgb = pap;
      // fluorescente: el color satura en vez de quemarse en blanco donde se acumula
      vec3 c = I.rgb / (1.0 + max(max(I.rgb.r, I.rgb.g), I.rgb.b) * 0.6);
      c *= (cov + halo * 4.0) * (1.0 + rimAmt * band * 0.6);
      inkEmit = gl_FrontFacing ? c * glow * (0.6 + 0.4 * clamp(I.a * 2.0, 0.0, 1.0)) : vec3(0.0);
    } else {
      // profundidad óptica: un piso (cualquier película de tinta ya cubre) + el espesor
      vec3 dir = I.rgb / max(rho, 1e-4);
      vec3 A = dir * (cov * (inkFloor + rho * inkOpacity + rimAmt * band) + halo * rho) * (1.0 + 0.2 * fibers);
      diffuseColor.rgb = gl_FrontFacing ? pap * exp(-A) : pap * exp(-I.rgb * bleed);
    }
    if (!gl_FrontFacing) { inkCov = 0.0; inkWet = 0.0; inkGrad = vec2(0.0); }
  }
`;

class Card {
  constructor(makeMat) {
    this.group = new THREE.Group();
    this.left = new THREE.Group(); this.right = new THREE.Group();
    const g = new THREE.PlaneGeometry(W / 2, H);
    this.matL = makeMat(0); this.matR = makeMat(0.5);
    this.meshL = new THREE.Mesh(g.clone().translate(-W / 4, 0, 0), this.matL);
    this.meshR = new THREE.Mesh(g.clone().translate(W / 4, 0, 0), this.matR);
    for (const m of [this.meshL, this.meshR]) { m.castShadow = true; m.receiveShadow = true; }
    this.meshL.userData.uvOffset = 0; this.meshR.userData.uvOffset = 0.5;
    this.left.add(this.meshL); this.right.add(this.meshR);
    this.group.add(this.left, this.right);
  }
  setInk(tex) { this.matL.userData.own.tInk.value = tex; this.matR.userData.own.tInk.value = tex; }
  /** open = ángulo de reposo de la V (rad), fold 0 abierta … 1 cerrada. */
  pose(open, fold) {
    const h = open / 2;
    this.left.rotation.y = h;
    this.right.rotation.y = -h - fold * (Math.PI - open);
    this.right.position.z = 0.015 * fold;
  }
}

export class RorschachScene extends MusicScene {
  static id = 'rorschach';
  static title = 'Rorschach';
  constructor(app) {
    super(app, 'rorschach', 'Rorschach');
    this.fold = 0; this.curlBoost = 0; this.pressT = 0; this.spreadBass = 0;
    this.leaving = null; this.pointer = { down: false, x: 0, y: 0, px: 0, py: 0, moved: false };
    this.lastPad = null; this.brushHue = 0;
    this.look = { 'look.bloom': 0.45, 'look.bloomThreshold': 0.92, 'look.bloomRadius': 0.4, 'look.exposure': 1, 'fx.vineta': 0.45, 'fx.grano': 0.07, 'fx.contraste': 1.12, 'fx.saturacion': 1, 'fx.tinte': 0 };
    this.padLabels = { title: 'Rorschach · pincel de tinta', x: 'horizontal', y: 'vertical', programs: false };
  }

  defineParams() {
    super.defineParams();
    this.p('tinta', { type: 'option', options: ['negro', 'negro y rojo', 'pastel', 'neón'], default: 'negro y rojo', label: 'tinta (láminas I · II · VIII · luz negra)' });
    this.p('plegado', { type: 'option', options: Object.keys(FOLDS), default: 'cada 4 compases', label: 'plegar la lámina' });
    this.p('laminaNueva', { default: true, label: 'lámina nueva en cada sección' });
    this.p('apertura', { min: 0, max: 50, default: 10, step: 0.5, label: 'apertura en reposo (grados)' });
    this.p('cantidad', { min: 0, max: 3, default: 1, step: 0.01, label: 'cantidad de tinta' });
    this.p('expansion', { min: 0, max: 3, default: 1, step: 0.01, label: 'expansión de la mancha' });
    this.p('respiracion', { min: 0, max: 3, default: 0.7, step: 0.01, label: 'respiración en cada beat' });
    this.p('secado', { min: 0.05, max: 3, default: 0.45, step: 0.01, label: 'secado (brillo de tinta fresca)' });
    this.p('permanencia', { min: 0, max: 0.5, default: 0.015, step: 0.001, label: 'desvanecimiento de la tinta' });
    this.p('borde', { min: 0, max: 3, default: 0.9, step: 0.01, label: 'borde oscuro (anillo)' });
    this.p('ramificacion', { min: 0, max: 1, default: 0.85, step: 0.01, label: 'ramificación (dedos al expandirse)' });
    this.p('fibras', { min: 0, max: 3, default: 0.6, step: 0.01, label: 'fibra del papel (borde rasgado)' });
    this.p('relieve', { min: 0, max: 4, default: 1, step: 0.01, label: 'relieve de la tinta' });
    this.p('luz', { min: 0, max: 3, default: 1, step: 0.01, label: 'luz de galería' });
    this.p('halo', { min: 0, max: 4, default: 1, step: 0.01, label: 'halo en la pared (bajo)' });
    this.p('nueva', { type: 'trigger', label: 'lámina nueva' });
    this.p('plegar', { type: 'trigger', label: 'plegar ahora' });
  }

  build() {
    RectAreaLightUniformsLib.init();
    const s = this.scene;
    s.background = new THREE.Color(0x050506);
    this.fluid = new Fluid(this.app.renderer, { aspect: W / H, simRes: 128, dyeRes: 1024, curl: 2, velDissipation: 2.2, dyeDissipation: [0.015, 0.015, 0.015, 0.45], pressureIters: 20 });
    this.fluid.symmetry.mode = 1;
    this.snapRT = this.fluid.makeInkTarget();

    // uniformes compartidos por todas las caras
    this.U = {
      inkTexel: { value: this.fluid.dyeTexel.clone() }, cardSize: { value: new THREE.Vector2(W, H) },
      paper: { value: new THREE.Color(...PAPER.normal) }, neon: { value: 0 }, rimAmt: { value: 0.9 }, feather: { value: 1 },
      relief: { value: 1 }, glow: { value: 2 }, bleed: { value: 0.08 }, wetGloss: { value: 1 }, paperBump: { value: 1 }, breathe: { value: 1 }, inkOpacity: { value: 3 }, inkFloor: { value: 2.2 },
    };
    const makeMat = (offset) => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, specularIntensity: 0.35, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide });
      const own = { tInk: { value: null }, uvMap: { value: new THREE.Vector2(offset, 0.5) } };
      m.userData.own = own;
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.U, own);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec2 uvMap; varying vec2 vInkUv; varying vec3 vTanV, vBitV;')
          .replace('#include <uv_vertex>', `#include <uv_vertex>
            vInkUv = vec2(uvMap.x + uv.x * uvMap.y, uv.y);
            vTanV = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
            vBitV = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\n${inkPars}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${inkMain}`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, mix(0.42, 0.1, inkWet), inkCov);')
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            if (gl_FrontFacing) {
              vec2 g = inkGrad * relief * 0.005 * (0.35 + 0.65 * inkWet / max(inkCov, 1e-3));
              normal = normalize(normal - g.x * vTanV - g.y * vBitV);
              normal = inkBump(-vViewPosition, normal, vec2(dFdx(paperH), dFdy(paperH)) * 0.012 * paperBump * (1.0 - inkCov * 0.8));
            }`)
          .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\n#ifdef USE_CLEARCOAT\n  clearcoatNormal = normal;\n#endif')
          .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat = inkWet * wetGloss;\n  material.clearcoatRoughness = 0.05;\n#endif')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += inkEmit;');
      };
      m.customProgramCacheKey = () => 'rorschach-ink';
      return m;
    };
    this.card = new Card(makeMat); this.card.setInk(this.fluid.dyeTexture);
    this.old = new Card(makeMat); this.old.setInk(this.snapRT.texture); this.old.group.visible = false;
    s.add(this.card.group, this.old.group);

    // pared de yeso oscuro
    const wallMap = canvasTex(512, (n, m) => { const v = 30 + n * 34 + (m - 0.5) * 12; return [v, v * 0.97, v * 0.95]; }, true);
    const wallNrm = normalTex(256, (n) => n * 2.2, 1.4);
    wallMap.repeat.set(6, 4); wallNrm.repeat.set(6, 4);
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ map: wallMap, normalMap: wallNrm, roughness: 0.92, metalness: 0 }));
    this.wall.position.z = -1.8; this.wall.receiveShadow = true; s.add(this.wall);

    // spot de galería con sombra, relleno tenue, halo detrás de la lámina
    // bañador de pared desde arriba, rasante (~30° de la pared): luz pareja en toda la lámina
    // y el reflejo de la tinta húmeda no llega a la cámara
    this.keyLight = new THREE.DirectionalLight(0xfff6ec, 4.5);
    this.keyLight.position.set(-1.5, 12, 6.5); this.keyLight.target.position.set(0, 0, 0);
    this.keyLight.castShadow = true; this.keyLight.shadow.mapSize.set(2048, 2048); this.keyLight.shadow.bias = -0.0008; this.keyLight.shadow.normalBias = 0;   // normalBias sombrearía el dorso (doble cara)
    Object.assign(this.keyLight.shadow.camera, { left: -13, right: 13, top: 12, bottom: -12, near: 1, far: 40 });
    s.add(this.keyLight, this.keyLight.target);
    this.hemi = new THREE.HemisphereLight(0x8a96a8, 0x0c0c0e, 0.18); s.add(this.hemi);
    this.haloLight = new THREE.RectAreaLight(0xffffff, 0, W * 0.92, H * 0.92);
    this.haloLight.position.set(0, 0, -0.5); this.haloLight.lookAt(0, 0, -5); s.add(this.haloLight);
    this.uv = new THREE.SpotLight(0x6a3cff, 0, 0, 0.6, 0.8, 2);   // luz negra (modo neón)
    this.uv.position.set(4, 6, 15); this.uv.target.position.set(0, 0, 0); s.add(this.uv, this.uv.target);

    this.params.onChange((id, v) => {
      if (id === 'rorschach.nueva') this.newCard();
      if (id === 'rorschach.plegar') this.manualFold = 0.001;
      if (id === 'rorschach.tinta') { this.fluid.clearAll(); this.seed(); }
    });
    this.fixed = { pos: new THREE.Vector3(0, 0.15, 17), look: new THREE.Vector3(0, 0, 0), fov: 38 };
    this.subject.radius = 8; this.subject.distance = 17;
    this.seed();
  }

  get neon() { return this.v('tinta') === 'neón'; }

  /** Color de tinta para un gesto: absorbancia por canal (o emisión en neón). */
  inkFor(kind, midi = null) {
    const mode = this.v('tinta'), sec = this.cues.sectionIndex ?? 0;
    if (mode === 'neón') {
      const h = midi != null ? ((midi % 12) * 7 % 12) / 12 : { kick: 0.83, bass: 0.62, snare: 0.12, high: 0.5, hats: 0.33, brush: this.brushHue }[kind] ?? 0.9;
      const c = new THREE.Color().setHSL(this.hue((h + sec * 0.13) % 1), 1, 0.55);
      return [c.r * 2.2, c.g * 2.2, c.b * 2.2];
    }
    if (mode === 'negro') return BLACK;
    if (mode === 'negro y rojo') return kind === 'snare' || kind === 'note' || (kind === 'brush' && this.brushHue > 0.5) ? RED : BLACK;
    const i = midi != null ? (midi % 12) % 6 : { kick: 0, bass: 2, snare: 1, high: 3, hats: 4, brush: Math.floor(this.brushHue * 6) }[kind] ?? 5;
    return PASTELS[(i + sec) % 6];
  }

  /** Un punto cerca de la figura central (mitad izquierda; el espejo hace la otra). */
  nearAxis(spread = 1) {
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;   // ~ normal
    return [0.5 - 0.02 - Math.abs(g()) * 0.12 * spread, THREE.MathUtils.clamp(0.5 + g() * 0.2 * spread, 0.08, 0.92)];
  }

  /** Gota de tinta: x, y en 0..1 de la lámina; amount ≈ opacidad del centro. */
  drop(x, y, r, ink, amount, wet = 1) {
    const k = amount * this.v('cantidad');
    this.fluid.dye(x, y, r, ink[0] * k, ink[1] * k, ink[2] * k, wet * k);
  }

  seed() {
    const F = this.fluid;
    for (const [y, r] of [[0.62, 0.045], [0.42, 0.055], [0.28, 0.03]]) { this.drop(0.49, y, r, this.inkFor('kick'), 1, 0); F.burst(0.49, y, r * 1.4, 300); }
    this.pressT = 1;
  }

  newCard() {
    if (this.leaving) return;
    this.fluid.copyInk(this.snapRT);
    this.old.pose(THREE.MathUtils.degToRad(this.v('apertura')), this.fold);
    this.old.group.position.set(0, 0, 0.04); this.old.group.rotation.set(0, 0, 0); this.old.group.visible = true;
    this.leaving = { t: 0, side: Math.random() < 0.5 ? -1 : 1 };
    this.fluid.clearAll();
  }

  /** Cierre de la lámina: la tinta se aplasta y se abre hacia afuera. */
  press() {
    this.pressT = 1;
    this.fluid.spread.seed.set(Math.random() * 100, Math.random() * 100);
  }
  /** Apertura: al despegarse la tinta hace dedos y ramificaciones. */
  peel() {
    const F = this.fluid, CS = 200;
    this.pressT = Math.min(this.pressT, 0.15);
    // burbujas de aire atrapadas: los "ojos" blancos de la mancha
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) F.erase(0.5 - 0.03 - Math.random() * 0.14, 0.25 + Math.random() * 0.5, 0.006 + Math.random() * 0.014, 0.97);
    for (let i = 0; i < 22; i++) {
      const y = 0.1 + Math.random() * 0.8, x = 0.12 + Math.random() * 0.36, a = Math.PI + (Math.random() - 0.5) * 1.6;
      F.force(x, y, 0.008 + Math.random() * 0.012, Math.cos(a) * CS * (0.6 + Math.random()), Math.sin(a) * CS * (0.6 + Math.random()));
    }
    this.curlBoost = 1;
  }

  // ---------- interacción ----------
  hitCard(x, y) {
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = ray.intersectObjects([this.card.meshL, this.card.meshR], false)[0];
    if (!hit || !hit.uv) return null;
    if (hit.face.normal.clone().transformDirection(hit.object.matrixWorld).dot(ray.ray.direction) > 0) return null;   // dorso de la lámina
    return [hit.object.userData.uvOffset + hit.uv.x * 0.5, hit.uv.y];
  }
  onPointerDown(x, y) {
    const h = this.hitCard(x, y); if (!h) return;
    Object.assign(this.pointer, { down: true, x: h[0], y: h[1], px: h[0], py: h[1], moved: false });
    this.brushHue = Math.random();
    this.drop(h[0], h[1], 0.022, this.inkFor('brush'), 1); this.fluid.burst(h[0], h[1], 0.03, 250);
  }
  onPointerUp() { this.pointer.down = false; }
  onPointerMove(x, y, buttons = 0) {
    const P = this.pointer; if (buttons === 0) { P.down = false; return; }
    if (!P.down) return;
    const h = this.hitCard(x, y); if (!h) return;
    P.px = P.x; P.py = P.y; P.x = h[0]; P.y = h[1]; P.moved = true;
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), F = this.fluid, k = this.v2('fourier.intensidad'), thr = this.threshold, CS = 200;
    const neon = this.neon, B = c.bands, e = v('expansion');
    // solver: tinta viscosa; al despegarse la lámina, más vorticidad (ramificaciones)
    this.curlBoost = Math.max(0, this.curlBoost - dt * 1.6);
    F.o.curl = 2 + this.curlBoost * 22; F.o.velDissipation = 2.2;
    F.o.dyeDissipation = [v('permanencia'), v('permanencia'), v('permanencia'), v('secado')];

    // ---------- gestos de la música ----------
    if (B[0].hit > thr) {          // bombo: gota sobre el pliegue que se abre
      const s = B[0].hit * k, x = 0.5 - 0.012 - Math.random() * 0.05, y = 0.2 + Math.random() * 0.6, r = 0.012 + 0.016 * s;
      this.drop(x, y, r, this.inkFor('kick'), 0.6 * s);
      F.burst(x, y, r * 1.3, CS * 1.2 * s * e);
    }
    // bajo sostenido: la tinta se sigue abriendo (difusión más rápida)
    this.spreadBass = Math.max(0, (B[1].env - 0.25) / 0.75) * k;
    if (B[2].hit > thr) {          // caja: salpicadura
      const s = B[2].hit * k, [x0, y0] = this.nearAxis(1.4), ink = this.inkFor('snare');
      this.drop(x0, y0, 0.01 + 0.01 * s, ink, 0.8 * s);
      const n = 4 + Math.round(6 * s);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = 0.02 + Math.random() ** 2 * 0.12, x = x0 + Math.cos(a) * d * (H / W), y = y0 + Math.sin(a) * d;
        this.drop(x, y, 0.003 + Math.random() * 0.005, ink, 0.8 * s);
        F.force(x, y, 0.006, Math.cos(a) * CS * (1 + Math.random()) * s, Math.sin(a) * CS * (1 + Math.random()) * s);
      }
    }
    if (B[3].hit > thr * 1.3) {    // agudos: chorreado hacia abajo
      const s = B[3].hit * k, [x, y0] = this.nearAxis(1.2), y = Math.max(0.45, y0);
      this.drop(x, y, 0.007 + 0.005 * s, this.inkFor('high'), 0.8 * s);
      F.force(x, y, 0.008, 0, -CS * 1.4 * s);
    }
    if (B[4].hit > thr * 1.2) {    // platillos: rocío
      const s = B[4].hit * k, n = 1 + Math.round(3 * s), ink = this.inkFor('hats');
      for (let i = 0; i < n; i++) { const [x, y] = this.nearAxis(1.8); this.drop(x, y, 0.0018 + Math.random() * 0.003, ink, 0.8 * s); }
    }
    if (this.v2('fourier.notas')) for (const n of c.notesOn) {   // notas: tinta de color a la altura de la nota
      if (n.vel < 0.5) continue;
      const y = 0.12 + 0.76 * THREE.MathUtils.clamp((n.midi - 36) / 60, 0, 1), x = 0.5 - 0.03 - (1 - n.vel) * 0.22;
      this.drop(x, y, 0.007 + 0.01 * n.vel, this.inkFor('note', n.midi), 0.7 * n.vel * k);
    }
    // difusión: lenta siempre, rápida con el bajo y al prensar
    this.pressT = Math.max(0, this.pressT - dt * 1.8);
    F.spread.D = 0.012 * e * (0.25 + this.spreadBass * 1.5 + this.pressT * 6);
    F.spread.power = 1.5; F.spread.iters = 3; F.spread.noise = v('ramificacion');
    if (c.onSection && v('laminaNueva')) this.newCard();

    // ---------- plegado a tempo ----------
    const target = this.foldTarget(c);
    const was = this.fold;
    this.fold = target;
    if (this.fold >= 0.985 && was < 0.985) this.press();
    if (this.fold < 0.9 && was >= 0.9) this.peel();
    const open = THREE.MathUtils.degToRad(v('apertura'));
    this.card.pose(open, this.fold);

    // lámina vieja que se cae
    if (this.leaving) {
      const L = this.leaving; L.t += dt; const x = Math.min(1, L.t / 0.9), ei = easeIn(x);
      this.old.group.position.set(L.side * ei * 1.5, -ei * 17, 0.04 + x * 0.9);
      this.old.group.rotation.set(-x * 0.35, 0, L.side * ei * 0.35);
      if (x >= 1) { this.old.group.visible = false; this.leaving = null; }
    }

    // ---------- interacción ----------
    const P = this.pointer;
    if (P.down && P.moved) {
      const vx = (P.x - P.px) / Math.max(dt, 1e-3), vy = (P.y - P.py) / Math.max(dt, 1e-3);
      this.drop(P.x, P.y, 0.012, this.inkFor('brush'), 0.5);
      F.force(P.x, P.y, 0.02, vx * CS * 0.5, vy * CS * 0.5);
      P.moved = false;
    }
    const pad = this.app.kaoss;
    if (pad?.active) {
      const x = pad.x, y = pad.y, L = this.lastPad || { x, y };
      const vx = (x - L.x) / Math.max(dt, 1e-3), vy = (y - L.y) / Math.max(dt, 1e-3);
      if (!this.lastPad) this.brushHue = Math.random();
      this.drop(x, y, 0.014, this.inkFor('brush'), 0.45);
      F.force(x, y, 0.025, vx * CS * 0.5, vy * CS * 0.5);
      this.lastPad = { x, y };
    } else this.lastPad = null;

    F.step(dt);

    // ---------- dibujo ----------
    const U = this.U;
    this.card.setInk(F.dyeTexture);
    U.inkTexel.value.copy(F.dyeTexel);
    U.neon.value = neon ? 1 : 0; U.paper.value.setRGB(...(neon ? PAPER.neon : PAPER.normal));
    U.breathe.value = 1 - v('respiracion') * 0.45 * Math.exp(-c.beatPhase * 5) * (c.beatInBar === 0 ? 1.3 : 1) * k;
    const pastel = this.v('tinta') === 'pastel';
    U.inkOpacity.value = pastel ? 0.8 : 3; U.inkFloor.value = pastel ? 0.55 : 2.2;
    U.rimAmt.value = v('borde'); U.feather.value = v('fibras'); U.relief.value = v('relieve'); U.glow.value = 1.25 + this.kick * 0.6;
    const sec = this.sectionColor(c.section?.type ?? 0, 0.55, 0.6);
    this.keyLight.intensity = (neon ? 0.25 : 4.5) * v('luz');
    this.uv.intensity = neon ? 700 * v('luz') : 0;
    this.hemi.intensity = neon ? 0.04 : 0.18;
    this.haloLight.color.copy(sec);
    this.haloLight.intensity = v('halo') * ((neon ? 3 : 1.4) * Math.max(0, B[1].env - 0.15) * 2 + this.kick * (neon ? 4 : 2.5) + 0.15);
    this.finish(dt);
  }

  /** Cuánto está cerrada la lámina (0..1): se cierra en el último medio beat y se abre en un beat y medio. */
  foldTarget(c) {
    if (this.manualFold) {   // "plegar ahora"
      this.manualFold += c.dt / Math.max(0.2, c.beatDur);
      const s = this.manualFold;
      if (s > 2.4) { this.manualFold = 0; return 0; }
      return s < 0.5 ? easeIn(s / 0.5) : s < 0.75 ? 1 : 1 - smooth(Math.min(1, (s - 0.75) / 1.4));
    }
    const N = FOLDS[this.v('plegado')]; if (!N) return 0;
    const bd = Math.max(0.2, c.beatDur);
    let u = Infinity, sinceDown, closing;
    if (N > 0) {
      const next = c.beatsAhead(bd * 1.5).find((b) => b.downbeat);
      if (next) u = (next.t - c.t) / bd;
      closing = (c.bar + 1) % N === 0;
      sinceDown = c.bar % N === 0 ? c.beatInBar + c.beatPhase : Infinity;
    } else {   // en el cambio de sección
      const S = c.section; if (!S) return 0;
      u = S.t1 != null ? (S.t1 - c.t) / bd : Infinity; closing = true;
      sinceDown = (c.t - S.t0) / bd;
    }
    if (closing && u < 0.5) return easeIn(1 - u / 0.5);
    if (sinceDown < 0.25) return 1;
    if (sinceDown < 1.65) return 1 - smooth((sinceDown - 0.25) / 1.4);   // se despega lento y después se abre
    return 0;
  }
}
