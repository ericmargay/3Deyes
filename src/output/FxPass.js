import * as THREE from 'three';

/**
 * Efectos por ojo (después del bloom, antes de componer el estéreo), como el
 * panel FX de visualinst: estela (retroalimentación), caleidoscopio, prisma
 * (aberración cromática), viñeta, grano, deriva de tono, giro y túnel.
 * Se aplican idénticos a los dos ojos, así la fusión estéreo no se rompe.
 */
const vert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const frag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D map, prev;
  uniform float trails, kaleido, prism, vignette, grain, hue, twist, tunnel, time, aspect, rot, tintAmt, contrast, saturation;
  uniform vec3 tint;
  vec3 hueShift(vec3 c, float h) {
    const vec3 k = vec3(0.57735);
    float a = h * 6.28318, cs = cos(a), sn = sin(a);
    return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
  }
  vec2 mirror(vec2 uv) { return 1.0 - abs(mod(uv, 2.0) - 1.0); }
  float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 7.0) * 43758.5453); }
  void main() {
    vec2 uv = vUv;
    vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(c), a = atan(c.y, c.x);
    if (twist != 0.0) a += twist * (1.0 - smoothstep(0.0, 0.9, r)) * 3.0;
    if (kaleido >= 2.0) { float seg = 6.28318 / kaleido; a = mod(a - rot, seg); a = abs(a - seg * 0.5) + rot; }
    if (tunnel != 0.0) r = pow(r, 1.0 + tunnel * 0.8);
    c = r * vec2(cos(a), sin(a));
    uv = mirror(c / vec2(aspect, 1.0) + 0.5);
    vec3 col;
    if (prism > 0.0) {
      vec2 d = (uv - 0.5) * prism * 0.035;
      col = vec3(texture2D(map, mirror(uv + d)).r, texture2D(map, uv).g, texture2D(map, mirror(uv - d)).b);
    } else col = texture2D(map, uv).rgb;
    if (hue != 0.0) col = hueShift(col, hue);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    if (saturation != 1.0) col = mix(vec3(lum), col, saturation);
    if (tintAmt > 0.0) col = mix(col, tint * lum * 1.6, tintAmt);
    if (contrast != 1.0) col = max(vec3(0.0), (col - 0.18) * contrast + 0.18);
    if (vignette > 0.0) col *= 1.0 - vignette * smoothstep(0.35, 1.1, length((vUv - 0.5) * vec2(aspect, 1.0)) * 1.3);
    if (grain > 0.0) col += (rnd(vUv) - 0.5) * grain * 0.25;
    if (trails > 0.0) { vec3 p = texture2D(prev, vUv).rgb * trails; col = max(col, p); }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class FxPass {
  constructor(renderer, params) {
    this.renderer = renderer; this.params = params;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, prev: { value: null }, trails: { value: 0 }, kaleido: { value: 0 }, prism: { value: 0 }, vignette: { value: 0 }, grain: { value: 0 }, hue: { value: 0 }, twist: { value: 0 }, tunnel: { value: 0 }, time: { value: 0 }, aspect: { value: 1 }, rot: { value: 0 }, tintAmt: { value: 0 }, contrast: { value: 1 }, saturation: { value: 1 }, tint: { value: new THREE.Color(1, 0.3, 0.2) } },
      vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType };
    this.acc = [new THREE.WebGLRenderTarget(2, 2, o), new THREE.WebGLRenderTarget(2, 2, o)];   // una estela por ojo
    this.tmp = new THREE.WebGLRenderTarget(2, 2, o);
    this.copyMat = new THREE.MeshBasicMaterial({ map: null, depthTest: false, depthWrite: false });
    this.copyScene = new THREE.Scene(); this.copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat));
    this.hueAcc = 0; this.rot = 0;
    const p = params;
    p.define('fx.estela', { min: 0, max: 0.97, default: 0, step: 0.005, label: 'estela (trails)' });
    p.define('fx.caleidoscopio', { min: 0, max: 12, default: 0, step: 1, label: 'caleidoscopio (segmentos, 0 = no)' });
    p.define('fx.prisma', { min: 0, max: 1, default: 0, step: 0.01, label: 'prisma (aberración)' });
    p.define('fx.vineta', { min: 0, max: 1, default: 0.25, step: 0.01, label: 'viñeta' });
    p.define('fx.grano', { min: 0, max: 1, default: 0.08, step: 0.01, label: 'grano' });
    p.define('fx.tono', { min: -0.5, max: 0.5, default: 0, step: 0.001, label: 'deriva de tono (vueltas/s)' });
    p.define('fx.giro', { min: -1, max: 1, default: 0, step: 0.01, label: 'giro' });
    p.define('fx.tunel', { min: -1, max: 1, default: 0, step: 0.01, label: 'túnel' });
    p.define('fx.tinte', { min: 0, max: 1, default: 0, step: 0.01, label: 'tinte (color de la sección)' });
    p.define('fx.contraste', { min: 0.5, max: 2, default: 1, step: 0.01, label: 'contraste' });
    p.define('fx.saturacion', { min: 0, max: 2, default: 1, step: 0.01, label: 'saturación' });
    p.define('fx.auto', { default: true, label: 'el director cambia los FX por sección' });
    p.define('fx.reset', { type: 'trigger', label: 'quitar efectos' });
    p.onChange((id) => { if (id === 'fx.reset') this.reset(); });
  }

  /** Color del tinte (lo fija la escena con el color de la sección). */
  setTint(color) { this.material.uniforms.tint.value.copy(color); }

  reset() { const p = this.params; for (const [k, v] of Object.entries({ estela: 0, caleidoscopio: 0, prisma: 0, giro: 0, tunel: 0, tono: 0 })) p.set(`fx.${k}`, v, 'fx'); }

  /** Elige un juego de efectos al azar según la energía (lo llama el director en cada sección). */
  randomize(energy = 0.5) {
    const p = this.params, r = Math.random;
    p.set('fx.estela', r() < 0.5 ? 0 : 0.5 + r() * 0.42, 'fx');
    p.set('fx.caleidoscopio', r() < (0.1 + energy * 0.2) ? [3, 4, 5, 6, 8][Math.floor(r() * 5)] : 0, 'fx');
    p.set('fx.prisma', r() < 0.5 ? 0 : r() * 0.6 * (0.5 + energy), 'fx');
    p.set('fx.giro', r() < 0.7 ? 0 : (r() - 0.5) * 0.6, 'fx');
    p.set('fx.tunel', r() < 0.7 ? 0 : (r() - 0.5) * 0.8, 'fx');
    p.set('fx.tono', r() < 0.6 ? 0 : (r() - 0.5) * 0.1, 'fx');
  }

  get active() {
    const p = this.params;
    return p.get('fx.estela') > 0 || p.get('fx.caleidoscopio') >= 2 || p.get('fx.prisma') > 0 || p.get('fx.vineta') > 0 || p.get('fx.grano') > 0 || this.hueAcc !== 0 || p.get('fx.giro') !== 0 || p.get('fx.tunel') !== 0 || p.get('fx.tinte') > 0 || p.get('fx.contraste') !== 1 || p.get('fx.saturacion') !== 1;
  }

  tick(dt) { this.hueAcc = (this.hueAcc + this.params.get('fx.tono') * dt) % 1; if (this.params.get('fx.tono') === 0) this.hueAcc = 0; this.rot += dt * 0.1 * this.params.get('fx.giro'); }

  /** Aplica los efectos sobre rt (in-place) usando la estela del ojo `eye` (0 / 1). */
  apply(rt, eye, time) {
    if (!this.active) return;
    const r = this.renderer, p = this.params, u = this.material.uniforms;
    const acc = this.acc[eye];
    if (acc.width !== rt.width || acc.height !== rt.height) { acc.setSize(rt.width, rt.height); this.tmp.setSize(rt.width, rt.height); }
    u.map.value = rt.texture; u.prev.value = acc.texture;
    u.trails.value = p.get('fx.estela'); u.kaleido.value = p.get('fx.caleidoscopio'); u.prism.value = p.get('fx.prisma');
    u.vignette.value = p.get('fx.vineta'); u.grain.value = p.get('fx.grano'); u.hue.value = this.hueAcc; u.twist.value = p.get('fx.giro');
    u.tunnel.value = p.get('fx.tunel'); u.time.value = time; u.aspect.value = rt.width / rt.height; u.rot.value = this.rot;
    u.tintAmt.value = p.get('fx.tinte'); u.contrast.value = p.get('fx.contraste'); u.saturation.value = p.get('fx.saturacion');
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.tmp); r.render(this.scene, this.cam);
    // tmp → acc (estela) y tmp → rt (salida)
    this.copyMat.map = this.tmp.texture;
    r.setRenderTarget(acc); r.render(this.copyScene, this.cam);
    r.setRenderTarget(rt); r.render(this.copyScene, this.cam);
    r.setRenderTarget(prev);
  }
}
