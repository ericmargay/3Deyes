import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { MusicScene } from './MusicScene.js';
import { WetFloor } from '../../stage/WetFloor.js';
import { simplexNoise3D } from '../../shaders/noise.glsl.js';

/**
 * MURMULLO: una bandada de 262 144 partículas (estorninos) que vira con el
 * grave, se dispersa con los kicks y deja pasar una ola por su cuerpo con
 * las cajas. Todas comparten un rumbo que gira en cada beat (más en el
 * downbeat); el sub inclina el vuelo (banking); los cambios de sección
 * cambian la formación (esfera, disco, toro). Es la escena más estéreo:
 * puntos con paralaje real en un volumen.
 */
const velocityShader = /* glsl */ `
  ${simplexNoise3D}
  uniform float time, dt, curl, noiseScale, cohesion, align, damping, scatter, speedMax, radius, formation, waveAmp, wavePhase, bank;
  uniform vec3 center, heading, wavePerp;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    vec3 v = texture2D(textureVelocity, uv).xyz;
    vec3 p = pos.xyz, d = p - center;
    float r = length(d) + 1e-4;
    vec3 target;
    if (formation < 0.5) target = center + d / r * radius;
    else if (formation < 1.5) { vec3 q = d; q.y *= 0.2; target = center + normalize(q + 1e-4) * radius; target.y = center.y + d.y * 0.25; }
    else { vec2 ring = normalize(d.xz + 1e-4) * radius; vec3 rc = center + vec3(ring.x, 0.0, ring.y); vec3 t = p - rc; target = rc + normalize(t + 1e-4) * radius * 0.35; }
    float jitter = hash13(vec3(uv, 1.0));
    vec3 a = (target - p) * cohesion * (0.6 + 0.8 * jitter);
    a += curlNoise(p * noiseScale + vec3(0.0, time * 0.15, 0.0)) * curl;
    a += heading * align;
    a += vec3(0.0, -bank, 0.0) * (1.0 - jitter * 0.5);
    float ph = dot(d, heading) * 1.4 - wavePhase;
    a += wavePerp * sin(ph) * waveAmp * exp(-abs(ph) * 0.25);
    v = v * (1.0 - damping * dt) + a * dt;
    v += d / r * scatter * (0.5 + jitter);
    float sp = length(v);
    if (sp > speedMax) v *= speedMax / sp;
    gl_FragColor = vec4(v, 1.0);
  }
`;
const positionShader = /* glsl */ `
  uniform float dt, speed;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    vec3 v = texture2D(textureVelocity, uv).xyz;
    gl_FragColor = vec4(pos.xyz + v * dt * speed, pos.w);
  }
`;
const pointVert = /* glsl */ `
  uniform sampler2D texturePosition, textureVelocity;
  uniform float pointSize, brightness, shimmer, time;
  uniform vec3 colA, colB, colHi;
  varying vec3 vColor; varying float vA;
  void main() {
    vec4 pos = texture2D(texturePosition, uv);
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    float sp = clamp(length(vel) * 0.3, 0.0, 1.0);
    float tw = 0.5 + 0.5 * sin(time * 6.0 + pos.w * 60.0);
    vColor = mix(colA, colB, sp) * brightness + colHi * shimmer * tw;
    vA = 0.5;
    vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
    gl_PointSize = pointSize * (36.0 / max(-mv.z, 0.5)) * (0.7 + 0.5 * pos.w);
    gl_Position = projectionMatrix * mv;
  }
`;
const pointFrag = /* glsl */ `
  varying vec3 vColor; varying float vA;
  void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.04, r) * vA; gl_FragColor = vec4(vColor * a, a); }
`;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class MurmulloScene extends MusicScene {
  static id = 'murmullo';
  static title = 'Murmullo';
  constructor(app) { super(app, 'murmullo', 'Murmullo'); this.heading = new THREE.Vector3(1, 0, 0); this.headingTarget = new THREE.Vector3(1, 0, 0); this.wavePerp = new THREE.Vector3(0, 1, 0); this.wavePhase = 0; this.waveAmp = 0; this.formation = 0; this.center = new THREE.Vector3(); this.scatter = 0; }

  defineParams() {
    super.defineParams();
    this.p('resolucion', { type: 'option', options: ['256', '512'], default: '512', label: 'partículas (n²)' });
    this.p('radio', { min: 1, max: 10, default: 2.4, step: 0.01, label: 'radio de la formación' });
    this.p('cohesion', { min: 0, max: 10, default: 4.5, step: 0.01, label: 'cohesión' });
    this.p('curl', { min: 0, max: 20, default: 4, step: 0.01, label: 'turbulencia' });
    this.p('alineacion', { min: 0, max: 20, default: 5, step: 0.01, label: 'alineación al rumbo' });
    this.p('giro', { min: 0, max: 3, default: 1, step: 0.01, label: 'giro en cada beat' });
    this.p('dispersion', { min: 0, max: 3, default: 1, step: 0.01, label: 'dispersión en los kicks' });
    this.p('ola', { min: 0, max: 3, default: 1, step: 0.01, label: 'ola en las cajas' });
    this.p('velocidad', { min: 0, max: 4, default: 1, step: 0.01, label: 'velocidad' });
    this.p('tamano', { min: 0.2, max: 6, default: 0.8, step: 0.01, label: 'tamaño de punto' });
    this.p('brillo', { min: 0, max: 2, default: 0.3, step: 0.005, label: 'brillo' });
    this.p('formacion', { type: 'option', options: ['auto', 'esfera', 'disco', 'toro'], default: 'auto', label: 'formación' });
  }

  build() {
    this.scene.background = new THREE.Color(0x030308);
    this.scene.fog = new THREE.FogExp2(0x030308, 0.02);
    this.floor = new WetFloor({ size: 70, repeat: 10, puddles: 0.45, reflect: 0.8, color: 0x8088a0 }); this.floor.position.y = -3.6; this.floor.userData.helper = true; this.scene.add(this.floor);
    this.scene.add(new THREE.HemisphereLight(0x223355, 0x050508, 0.4));
    this.buildSim(parseInt(this.v('resolucion'), 10));
    this.params.onChange((id, value) => { if (id === 'murmullo.resolucion') this.buildSim(parseInt(value, 10)); });
    this.subject.radius = 4; this.subject.distance = 11;
    this.fixed = { pos: new THREE.Vector3(0, -0.2, 10.5), look: new THREE.Vector3(0, 0.6, 0), fov: 46 };
  }

  buildSim(size) {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); this.gpu?.dispose?.(); }
    this.gpu = new GPUComputationRenderer(size, size, this.app.renderer);
    const pos0 = this.gpu.createTexture(), vel0 = this.gpu.createTexture(), d = pos0.image.data;
    for (let i = 0; i < d.length; i += 4) { const r = 3 * Math.cbrt(Math.random()), th = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1); d[i] = r * Math.sin(ph) * Math.cos(th); d[i + 1] = r * Math.sin(ph) * Math.sin(th); d[i + 2] = r * Math.cos(ph); d[i + 3] = Math.random(); }
    this.velVar = this.gpu.addVariable('textureVelocity', velocityShader, vel0);
    this.posVar = this.gpu.addVariable('texturePosition', positionShader, pos0);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    const vu = this.velVar.material.uniforms, pu = this.posVar.material.uniforms;
    for (const k of ['time', 'dt', 'curl', 'noiseScale', 'cohesion', 'align', 'damping', 'scatter', 'speedMax', 'radius', 'formation', 'waveAmp', 'wavePhase', 'bank']) vu[k] = { value: 0 };
    vu.center = { value: new THREE.Vector3() }; vu.heading = { value: new THREE.Vector3(1, 0, 0) }; vu.wavePerp = { value: new THREE.Vector3(0, 1, 0) };
    pu.dt = { value: 0 }; pu.speed = { value: 1 };
    const err = this.gpu.init(); if (err) console.error('GPGPU:', err);
    const n = size * size, geo = new THREE.BufferGeometry(), uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uvs[i * 2] = ((i % size) + 0.5) / size; uvs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size; }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.pointMat = new THREE.ShaderMaterial({
      uniforms: { texturePosition: { value: null }, textureVelocity: { value: null }, pointSize: { value: 1 }, brightness: { value: 1 }, shimmer: { value: 0 }, time: { value: 0 }, colA: { value: new THREE.Color() }, colB: { value: new THREE.Color() }, colHi: { value: new THREE.Color() } },
      vertexShader: pointVert, fragmentShader: pointFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.pointMat); this.points.name = 'bandada'; this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), k = this.v2('fourier.intensidad'), sdt = Math.min(dt, 1 / 30);
    // rumbo: gira en cada beat; el sub inclina el vuelo
    if (c.onBeat) {
      const ang = (c.onDownbeat ? 1.2 : 0.55) * v('giro') * (0.6 + c.beatStrength) * (Math.random() < 0.5 ? -1 : 1);
      this.headingTarget.applyAxisAngle(_v.set(0, 1, 0), ang).applyAxisAngle(_v.set(1, 0, 0), (Math.random() - 0.5) * 0.6 * v('giro')).normalize();
    }
    this.heading.lerp(this.headingTarget, 1 - Math.exp(-dt * 3)).normalize();
    // ola en cajas (medio / agudo)
    const snare = Math.max(c.bands[2].hit, c.bands[3].hit);
    if (snare > this.threshold) { this.waveAmp = Math.max(this.waveAmp, snare * 14 * v('ola') * k); this.wavePhase = -3; this.wavePerp.set(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(); }
    this.wavePhase += dt * 9; this.waveAmp *= Math.exp(-dt * 2.5);
    // dispersión en kicks
    this.scatter = c.bands[0].hit > this.threshold ? c.bands[0].hit * 1.6 * v('dispersion') * k : 0;
    // formación por sección
    const f = v('formacion');
    if (f === 'auto') { if (c.onSection) this.formation = (this.formation + 1 + Math.floor(Math.random() * 2)) % 3; } else this.formation = ['esfera', 'disco', 'toro'].indexOf(f);
    this.center.set(Math.sin(t * 0.21) * 1.2, Math.sin(t * 0.17 + 1) * 0.7, Math.sin(t * 0.13 + 2) * 0.8);

    const vu = this.velVar.material.uniforms, pu = this.posVar.material.uniforms;
    vu.time.value = t; vu.dt.value = sdt; vu.curl.value = v('curl') * (0.6 + c.bands[2].env); vu.noiseScale.value = 0.22;
    vu.cohesion.value = v('cohesion'); vu.align.value = v('alineacion') * (0.5 + c.loud); vu.damping.value = 1.2; vu.scatter.value = this.scatter;
    vu.speedMax.value = 6 + 6 * c.loud; vu.radius.value = v('radio') * (1 + c.bands[1].env * 0.35); vu.formation.value = this.formation;
    vu.waveAmp.value = this.waveAmp; vu.wavePhase.value = this.wavePhase; vu.bank.value = c.bands[0].env * 4;
    vu.center.value.copy(this.center); vu.heading.value.copy(this.heading); vu.wavePerp.value.copy(this.wavePerp);
    pu.dt.value = sdt; pu.speed.value = v('velocidad');
    this.gpu.compute();
    const u = this.pointMat.uniforms;
    u.texturePosition.value = this.gpu.getCurrentRenderTarget(this.posVar).texture; u.textureVelocity.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    u.pointSize.value = v('tamano') * this.app.renderer.getPixelRatio() * (1 + this.kick * 0.5); u.brightness.value = v('brillo') * (0.8 + this.flash * 0.6); u.shimmer.value = c.bands[4].env * 0.6 * v('brillo'); u.time.value = t;
    const sec = c.section?.type ?? 0;
    u.colA.value.copy(this.sectionColor(sec, 0.45)); u.colB.value.copy(this.sectionColor(sec + 1, 0.7)); u.colHi.value.setHSL(this.hue(0.15), 0.6, 0.9);

    this.subject.center.copy(this.center);
    this.finish(dt);
  }
}
