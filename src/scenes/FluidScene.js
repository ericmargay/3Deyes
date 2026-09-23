import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { BaseScene } from './BaseScene.js';
import { simplexNoise3D } from '../shaders/noise.glsl.js';

/**
 * Fluido de partículas en GPU: un campo de curl noise (libre de divergencia,
 * se ve como humo / tinta en agua) empuja cientos de miles de partículas.
 * En estéreo el volumen se lee muy bien porque son puntos con paralaje real.
 */
const velocityShader = /* glsl */ `
  ${simplexNoise3D}
  uniform float time, dt, noiseScale, noiseSpeed, curl, attract, radius, damping, vortex, burst, gravity;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    vec4 vel = texture2D(textureVelocity, uv);
    vec3 p = pos.xyz;
    vec3 c = curlNoise(p * noiseScale + vec3(0.0, time * noiseSpeed, 0.0)) * curl;
    float r = length(p);
    vec3 toCenter = -p / max(r, 0.001);
    vec3 shell = toCenter * (r - radius) * attract;       // atracción hacia una esfera de radio 'radius'
    vec3 vort = vec3(-p.z, 0.0, p.x) * vortex;            // remolino alrededor de Y
    vec3 a = c + shell + vort + vec3(0.0, gravity, 0.0);
    vec3 v = vel.xyz * (1.0 - damping * dt) + a * dt;
    v += (p / max(r, 0.001)) * burst;                      // ráfaga radial (trigger)
    gl_FragColor = vec4(v, 1.0);
  }
`;

const positionShader = /* glsl */ `
  ${simplexNoise3D}
  uniform float time, dt, speed, lifetime, spread, reset;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    vec4 vel = texture2D(textureVelocity, uv);
    vec3 p = pos.xyz + vel.xyz * dt * speed;
    float life = pos.w - dt / max(lifetime, 0.01);
    if (life <= 0.0 || reset > 0.5) {
      vec3 h = vec3(hash13(vec3(uv, time)), hash13(vec3(uv.yx, time + 3.1)), hash13(vec3(uv * 7.0, time + 9.7)));
      vec3 dir = normalize(h * 2.0 - 1.0);
      p = dir * spread * pow(hash13(vec3(uv, time + 1.3)), 0.333);
      life = 1.0 + hash13(vec3(uv, time + 5.0));
    }
    gl_FragColor = vec4(p, life);
  }
`;

const pointVert = /* glsl */ `
  uniform sampler2D texturePosition, textureVelocity;
  uniform float pointSize, hue, hueSpread, brightness;
  varying vec3 vColor;
  varying float vAlpha;
  vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
  void main() {
    vec4 pos = texture2D(texturePosition, uv);
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    float sp = clamp(length(vel) * 0.25, 0.0, 1.0);
    vColor = hsv2rgb(vec3(hue + sp * hueSpread + pos.w * 0.05, 0.75, brightness));
    float lifeFade = smoothstep(0.0, 0.15, pos.w) * smoothstep(2.0, 1.6, pos.w);
    vAlpha = lifeFade;
    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
    gl_PointSize = pointSize * (40.0 / max(-mv.z, 0.5));
    gl_Position = projectionMatrix * mv;
  }
`;

const pointFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    float a = smoothstep(0.25, 0.05, r) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class FluidScene extends BaseScene {
  static id = 'fluid';
  constructor(app) {
    super(app, 'fluid', 'Fluido');
    this.size = 256;
    this.orbit = 0;
    this.burst = 0;
    this.resetFlag = 0;
  }

  defineParams() {
    this.p('resolution', { type: 'option', options: ['128', '256', '512'], default: '256', label: 'partículas (n²)' });
    this.p('speed', { min: 0, max: 5, default: 1, step: 0.01, label: 'velocidad' });
    this.p('noiseScale', { min: 0.02, max: 2, default: 0.18, step: 0.001, label: 'escala ruido' });
    this.p('noiseSpeed', { min: 0, max: 2, default: 0.2, step: 0.001, label: 'evolución ruido' });
    this.p('curl', { min: 0, max: 20, default: 6, step: 0.01, label: 'fuerza curl' });
    this.p('attract', { min: 0, max: 10, default: 0.6, step: 0.01, label: 'atracción esfera' });
    this.p('radius', { min: 0, max: 12, default: 4, step: 0.01, label: 'radio esfera' });
    this.p('vortex', { min: -5, max: 5, default: 0.6, step: 0.01, label: 'remolino' });
    this.p('gravity', { min: -10, max: 10, default: 0, step: 0.01, label: 'gravedad' });
    this.p('damping', { min: 0, max: 5, default: 0.8, step: 0.01, label: 'amortiguación' });
    this.p('lifetime', { min: 0.5, max: 30, default: 8, step: 0.1, label: 'vida (s)' });
    this.p('spread', { min: 0.1, max: 12, default: 5, step: 0.01, label: 'radio de nacimiento' });
    this.p('pointSize', { min: 0.2, max: 12, default: 1.5, step: 0.01, label: 'tamaño punto' });
    this.p('brightness', { min: 0, max: 2, default: 0.25, step: 0.01, label: 'brillo' });
    this.p('hue', { min: 0, max: 1, default: 0.55, step: 0.001, label: 'color' });
    this.p('hueSpread', { min: -1, max: 1, default: 0.35, step: 0.001, label: 'color por velocidad' });
    this.p('burst', { type: 'trigger', label: 'ráfaga' });
    this.p('reset', { type: 'trigger', label: 'reiniciar partículas' });
    this.p('orbit', { min: -30, max: 30, default: 4, step: 0.1, label: 'órbita cámara (°/s)' });
    this.p('distance', { min: 3, max: 40, default: 14, step: 0.01, label: 'distancia cámara' });
    this.p('fov', { min: 15, max: 100, default: 50, step: 0.1, label: 'fov' });
  }

  build() {
    this.scene.background = new THREE.Color(0x050310);
    this.buildSim(parseInt(this.params.get('fluid.resolution'), 10));
    this.params.onChange((id, value) => {
      if (id === 'fluid.resolution') this.buildSim(parseInt(value, 10));
      if (id === 'fluid.burst') this.burst = 1;
      if (id === 'fluid.reset') this.resetFlag = 1;
    });
  }

  buildSim(size) {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); this.gpu?.dispose?.(); }
    this.size = size;
    const renderer = this.app.renderer;
    this.gpu = new GPUComputationRenderer(size, size, renderer);
    const pos0 = this.gpu.createTexture();
    const vel0 = this.gpu.createTexture();
    const d = pos0.image.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = 3 * Math.cbrt(Math.random()), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      d[i] = r * Math.sin(ph) * Math.cos(th); d[i + 1] = r * Math.sin(ph) * Math.sin(th); d[i + 2] = r * Math.cos(ph); d[i + 3] = Math.random() * 2;
    }
    this.velVar = this.gpu.addVariable('textureVelocity', velocityShader, vel0);
    this.posVar = this.gpu.addVariable('texturePosition', positionShader, pos0);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    const vu = this.velVar.material.uniforms, pu = this.posVar.material.uniforms;
    for (const k of ['time', 'dt', 'noiseScale', 'noiseSpeed', 'curl', 'attract', 'radius', 'damping', 'vortex', 'burst', 'gravity']) vu[k] = { value: 0 };
    for (const k of ['time', 'dt', 'speed', 'lifetime', 'spread', 'reset']) pu[k] = { value: 0 };
    const err = this.gpu.init();
    if (err) console.error('GPGPU:', err);

    // geometría de puntos: un vértice por texel
    const n = size * size;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uvs[i * 2] = ((i % size) + 0.5) / size; uvs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size; }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.pointMat = new THREE.ShaderMaterial({
      uniforms: {
        texturePosition: { value: null }, textureVelocity: { value: null },
        pointSize: { value: 2 }, hue: { value: 0.5 }, hueSpread: { value: 0.3 }, brightness: { value: 1 },
      },
      vertexShader: pointVert, fragmentShader: pointFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.pointMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  update(dt, t) {
    const v = (n) => this.v(n);
    const sdt = Math.min(dt, 1 / 30);
    const vu = this.velVar.material.uniforms, pu = this.posVar.material.uniforms;
    vu.time.value = t; vu.dt.value = sdt;
    vu.noiseScale.value = v('noiseScale'); vu.noiseSpeed.value = v('noiseSpeed'); vu.curl.value = v('curl');
    vu.attract.value = v('attract'); vu.radius.value = v('radius'); vu.damping.value = v('damping');
    vu.vortex.value = v('vortex'); vu.gravity.value = v('gravity'); vu.burst.value = this.burst * 6; this.burst = 0;
    pu.time.value = t; pu.dt.value = sdt; pu.speed.value = v('speed'); pu.lifetime.value = v('lifetime'); pu.spread.value = v('spread');
    pu.reset.value = this.resetFlag; this.resetFlag = 0;
    this.gpu.compute();
    const u = this.pointMat.uniforms;
    u.texturePosition.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    u.textureVelocity.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    u.pointSize.value = v('pointSize') * this.app.renderer.getPixelRatio();
    u.hue.value = v('hue'); u.hueSpread.value = v('hueSpread'); u.brightness.value = v('brightness');

    this.orbit += v('orbit') * dt;
    const az = THREE.MathUtils.degToRad(this.orbit), d = v('distance');
    this.camera.position.set(Math.sin(az) * d, Math.sin(t * 0.13) * 2, Math.cos(az) * d);
    this.camera.lookAt(0, 0, 0);
    this.camera.fov = v('fov');
  }
}
