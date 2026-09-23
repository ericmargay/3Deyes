import * as THREE from 'three';
import { computeLayout } from '../core/StereoMath.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * Salida estéreo.
 *
 * Renderiza el ojo izquierdo y el derecho a dos render targets y los compone
 * en pantalla con un shader según el modo:
 *
 *   mono      → una sola imagen (cámara central)
 *   parallel  → lado a lado, ojo izquierdo a la izquierda (visión paralela)
 *   cross     → lado a lado, ojos intercambiados (visión cruzada / bizca)
 *   overunder → arriba / abajo
 *   anaglyph  → rojo-cian (matrices de Dubois), para lentes
 *
 * Parámetros importantes para proyección sobre murales:
 *   stereo.scale  → tamaño de cada imagen dentro de su mitad (imágenes más
 *                   chicas = más fácil de fusionar en cross-eye a gran escala)
 *   stereo.gap    → separación entre las dos imágenes
 *   stereo.eyeSep → separación interocular en unidades de escena (profundidad)
 *   stereo.focus  → distancia de convergencia (plano que queda "en la pared")
 */
export const STEREO_MODES = ['mono', 'parallel', 'cross', 'overunder', 'anaglyph', 'vr'];

const compositeVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const compositeFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D mapL;
  uniform sampler2D mapR;
  uniform vec4 rectL;      // x, y, w, h en coords 0..1 de pantalla
  uniform vec4 rectR;
  uniform int mode;        // 0 mono, 1 dos imágenes, 2 anaglifo
  uniform vec3 bg;
  uniform float fusionDots;
  uniform float aspect;    // aspecto de pantalla para dibujar círculos redondos
  uniform mat3 colorMatrixLeft;
  uniform mat3 colorMatrixRight;
  uniform int anaglyphStyle; // 0 Dubois, 1 color simple, 2 gris
  uniform vec2 vrK;          // distorsión radial (k1, k2) para las lentes del visor; 0 = sin distorsión
  uniform float rectAspect;  // aspecto físico del rectángulo de cada ojo

  // pre-distorsión barril: compensa el efecto cojín de las lentes
  bool distort(inout vec2 local) {
    if (vrK.x == 0.0 && vrK.y == 0.0) return true;
    vec2 c = (local - 0.5) * 2.0;
    vec2 cp = vec2(c.x * rectAspect, c.y);
    float r2 = dot(cp, cp);
    float f = 1.0 + vrK.x * r2 + vrK.y * r2 * r2;
    local = 0.5 + c * f * 0.5;
    return all(greaterThanEqual(local, vec2(0.0))) && all(lessThan(local, vec2(1.0)));
  }

  bool inRect(vec2 uv, vec4 r, out vec2 local) {
    local = (uv - r.xy) / r.zw;
    return all(greaterThanEqual(local, vec2(0.0))) && all(lessThan(local, vec2(1.0)));
  }

  float dot2(vec2 uv, vec4 r) {
    // punto de ayuda a la fusión: círculo centrado arriba de cada imagen
    vec2 c = vec2(r.x + r.z * 0.5, r.y + r.w + 0.025);
    vec2 d = (uv - c) * vec2(aspect, 1.0);
    return 1.0 - smoothstep(0.006, 0.009, length(d));
  }

  void main() {
    vec2 uv = vUv;
    vec3 col = bg;
    vec2 lu; vec2 ru;
    if (mode == 2) {
      bool inl = inRect(uv, rectL, lu);
      if (inl) {
        vec3 l = texture2D(mapL, lu).rgb;
        vec3 r = texture2D(mapR, lu).rgb;
        if (anaglyphStyle == 0) {
          col = clamp(colorMatrixLeft * l + colorMatrixRight * r, 0.0, 1.0);
        } else if (anaglyphStyle == 1) {
          col = vec3(l.r, r.g, r.b);
        } else {
          float gl = dot(l, vec3(0.299, 0.587, 0.114));
          float gr = dot(r, vec3(0.299, 0.587, 0.114));
          col = vec3(gl, gr, gr);
        }
      }
    } else {
      if (inRect(uv, rectL, lu) && distort(lu)) col = texture2D(mapL, lu).rgb;
      if (mode == 1 && inRect(uv, rectR, ru) && distort(ru)) col = texture2D(mapR, ru).rgb;
      if (fusionDots > 0.5) {
        float d = dot2(uv, rectL);
        if (mode == 1) d = max(d, dot2(uv, rectR));
        col = mix(col, vec3(1.0), d);
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Disposición para un visor de teléfono (tipo Cardboard / Gear VR): cada imagen
 * centrada bajo su lente. lensSep y screenW en mm; aspect = ancho/alto del canvas.
 */
export function computeVrLayout(lensSep, screenW, imageScale, aspect) {
  const half = Math.min(0.49, (lensSep / screenW) / 2);
  const w = Math.min(imageScale * 0.5, half * 2 * 0.98, (1 - 2 * half));
  const h = Math.min(1, w * aspect);
  const y = (1 - h) / 2;
  return { rL: { x: 0.5 - half - w / 2, y, w, h }, rR: { x: 0.5 + half - w / 2, y, w, h } };
}

export class StereoOutput {
  constructor(renderer, params) {
    this.renderer = renderer;
    this.params = params;
    this.stereo = new THREE.StereoCamera();
    this.stereo.aspect = 1;

    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType };
    this.rtL = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtR = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtL.depthTexture = null;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        mapL: { value: this.rtL.texture },
        mapR: { value: this.rtR.texture },
        rectL: { value: new THREE.Vector4(0, 0, 1, 1) },
        rectR: { value: new THREE.Vector4(0, 0, 1, 1) },
        mode: { value: 0 },
        bg: { value: new THREE.Color(0x000000) },
        fusionDots: { value: 0 },
        aspect: { value: 1 },
        anaglyphStyle: { value: 0 },
        vrK: { value: new THREE.Vector2(0, 0) },
        rectAspect: { value: 1 },
        colorMatrixLeft: { value: new THREE.Matrix3().fromArray([
          0.456100, -0.0400822, -0.0152161,
          0.500484, -0.0378246, -0.0205971,
          0.176381, -0.0157589, -0.00546856]) },
        colorMatrixRight: { value: new THREE.Matrix3().fromArray([
          -0.0434706, 0.378476, -0.0721527,
          -0.0879388, 0.73364, -0.112961,
          -0.00155529, -0.0184503, 1.2264]) },
      },
      vertexShader: compositeVert,
      fragmentShader: compositeFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));

    this.eyeW = 2; this.eyeH = 2;
    // bloom (luces neón): se aplica sobre cada ojo antes de componer
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.4, 0.9);
    this.bloomW = 0; this.bloomH = 0;
    this.defineParams();
  }

  applyBloom(rt) {
    const strength = this.params.get('look.bloom');
    if (strength <= 0) return;
    if (this.bloomW !== rt.width || this.bloomH !== rt.height) { this.bloom.setSize(rt.width, rt.height); this.bloomW = rt.width; this.bloomH = rt.height; }
    this.bloom.strength = strength;
    this.bloom.threshold = this.params.get('look.bloomThreshold');
    this.bloom.radius = this.params.get('look.bloomRadius');
    this.bloom.render(this.renderer, null, rt, 0, false);
  }

  defineParams() {
    const p = this.params;
    p.define('stereo.mode', { type: 'option', options: STEREO_MODES, default: 'cross', label: 'modo' });
    p.define('stereo.swap', { default: false, label: 'swap ojos' });
    p.define('stereo.eyeSep', { min: 0, max: 1.5, default: 0.25, step: 0.001, label: 'separación ojos' });
    p.define('stereo.focus', { min: 0.5, max: 40, default: 10, step: 0.01, label: 'convergencia' });
    p.define('stereo.scale', { min: 0.2, max: 1, default: 0.9, step: 0.001, label: 'tamaño imagen' });
    p.define('stereo.gap', { min: 0, max: 0.3, default: 0.02, step: 0.001, label: 'separación imágenes' });
    p.define('stereo.fusionDots', { default: true, label: 'puntos de fusión' });
    p.define('stereo.anaglyphStyle', { type: 'option', options: ['dubois', 'color', 'gray'], default: 'dubois', label: 'estilo anaglifo' });
    p.define('stereo.bg', { type: 'number', min: 0, max: 1, default: 0.0, step: 0.001, label: 'fondo (gris)' });
    p.define('stereo.vrLensSep', { min: 50, max: 75, default: 63, step: 0.5, label: 'VR: separación lentes (mm)' });
    p.define('stereo.vrScreenW', { min: 100, max: 220, default: 154, step: 0.5, label: 'VR: ancho pantalla (mm)' });
    p.define('stereo.vrFov', { min: 50, max: 120, default: 90, step: 0.5, label: 'VR: fov' });
    p.define('stereo.vrImageScale', { min: 0.4, max: 1, default: 0.9, step: 0.01, label: 'VR: tamaño imagen' });
    p.define('stereo.vrK1', { min: 0, max: 1, default: 0.22, step: 0.005, label: 'VR: distorsión k1' });
    p.define('stereo.vrK2', { min: 0, max: 0.6, default: 0.24, step: 0.005, label: 'VR: distorsión k2' });
    p.define('look.bloom', { min: 0, max: 3, default: 0.8, step: 0.01, label: 'bloom (neón)' });
    p.define('look.bloomThreshold', { min: 0, max: 1.5, default: 0.9, step: 0.01, label: 'bloom umbral' });
    p.define('look.bloomRadius', { min: 0, max: 1, default: 0.5, step: 0.01, label: 'bloom radio' });
  }

  nextMode() {
    const cur = this.params.get('stereo.mode');
    const i = (STEREO_MODES.indexOf(cur) + 1) % STEREO_MODES.length;
    this.params.set('stereo.mode', STEREO_MODES[i]);
  }

  /** Calcula rectángulos (en 0..1) y tamaño de textura por ojo. */
  layout(W, H, modeOverride = null) {
    const mode = modeOverride || this.params.get('stereo.mode');
    const p = this.params;
    const { rL: l, rR: r } = mode === 'vr'
      ? computeVrLayout(p.get('stereo.vrLensSep'), p.get('stereo.vrScreenW'), p.get('stereo.vrImageScale'), W / H)
      : computeLayout(mode, p.get('stereo.scale'), p.get('stereo.gap'));
    const rL = new THREE.Vector4(l.x, l.y, l.w, l.h), rR = new THREE.Vector4(r.x, r.y, r.w, r.h);
    return { rL, rR, eyeW: Math.max(2, Math.round(W * l.w)), eyeH: Math.max(2, Math.round(H * l.h)), mode };
  }

  /**
   * Renderiza scene con camera hacia `target` (WebGLRenderTarget o null = pantalla).
   * `beforeEye(camera, eyeIndex)` permite a la escena ajustar cosas por ojo.
   */
  render(scene, camera, target = null, W = null, H = null, modeOverride = null) {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    const fullW = W ?? Math.round(size.x * pr);
    const fullH = H ?? Math.round(size.y * pr);
    const { rL, rR, eyeW, eyeH, mode } = this.layout(fullW, fullH, modeOverride);

    if (this.rtL.width !== eyeW || this.rtL.height !== eyeH) {
      this.rtL.setSize(eyeW, eyeH); this.rtR.setSize(eyeW, eyeH);
    }

    // cámara por ojo
    camera.aspect = eyeW / eyeH;
    if (mode === 'vr') camera.fov = this.params.get('stereo.vrFov');
    camera.focus = this.params.get('stereo.focus');
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.stereo.eyeSep = this.params.get('stereo.eyeSep');
    this.stereo.update(camera);

    const swap = this.params.get('stereo.swap') !== (mode === 'cross');
    const u0 = this.material.uniforms;
    if (mode === 'vr') { u0.vrK.value.set(this.params.get('stereo.vrK1'), this.params.get('stereo.vrK2')); u0.rectAspect.value = (rL.z * fullW) / (rL.w * fullH); } else u0.vrK.value.set(0, 0);
    const camL = swap ? this.stereo.cameraR : this.stereo.cameraL;
    const camR = swap ? this.stereo.cameraL : this.stereo.cameraR;

    const prevTarget = r.getRenderTarget();
    if (mode === 'mono') {
      r.setRenderTarget(this.rtL); r.clear(); r.render(scene, camera); this.applyBloom(this.rtL);
    } else {
      r.setRenderTarget(this.rtL); r.clear(); r.render(scene, camL); this.applyBloom(this.rtL);
      r.setRenderTarget(this.rtR); r.clear(); r.render(scene, camR); this.applyBloom(this.rtR);
    }

    // composición
    const u = this.material.uniforms;
    u.rectL.value.copy(rL); u.rectR.value.copy(rR);
    u.mode.value = mode === 'mono' ? 0 : mode === 'anaglyph' ? 2 : 1;
    u.fusionDots.value = this.params.get('stereo.fusionDots') && mode !== 'anaglyph' && mode !== 'mono' && mode !== 'vr' ? 1 : 0;
    u.aspect.value = fullW / fullH;
    u.anaglyphStyle.value = ['dubois', 'color', 'gray'].indexOf(this.params.get('stereo.anaglyphStyle'));
    const g = this.params.get('stereo.bg'); u.bg.value.setRGB(g, g, g);

    r.setRenderTarget(target);
    r.render(this.quadScene, this.quadCam);
    r.setRenderTarget(prevTarget);
  }

  dispose() { this.rtL.dispose(); this.rtR.dispose(); this.material.dispose(); }
}
