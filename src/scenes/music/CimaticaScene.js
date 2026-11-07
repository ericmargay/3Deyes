import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { MusicScene } from './MusicScene.js';
import { WetFloor } from '../../stage/WetFloor.js';

/**
 * CIMÁTICA: una placa de Chladni. Cada nota que suena excita un modo de
 * vibración de la placa (n, m según su altura):
 *     u(x, y) = Σ a·[cos(nπx)·cos(mπy) − cos(mπx)·cos(nπy)]
 * La arena (262 144 granos en GPU) se escapa de donde la placa vibra y se
 * junta en las líneas nodales (u = 0): la armonía del instante se vuelve
 * figura, como en el experimento real. Los kicks sacuden la placa y lanzan
 * la arena al aire; vuelve a caer y a ordenarse. Con la anticipación, la
 * figura del próximo acorde empieza a insinuarse antes de que suene.
 */
const MAXM = 12;
const modesGLSL = /* glsl */ `
  uniform vec3 modes[${MAXM}];   // n, m, amplitud
  uniform int nModes;
  uniform float ripple, rippleT;
  float plate(vec2 q) {   // q en [-1, 1]
    float u = 0.0;
    for (int i = 0; i < ${MAXM}; i++) { if (i >= nModes) break; vec3 md = modes[i]; u += md.z * (cos(md.x * 3.14159 * q.x) * cos(md.y * 3.14159 * q.y) - cos(md.y * 3.14159 * q.x) * cos(md.x * 3.14159 * q.y)); }
    float r = length(q);
    u += ripple * cos(r * 14.0 - rippleT * 18.0) * exp(-r * 1.5) * exp(-rippleT * 2.0);
    return u;
  }
`;
const velShader = /* glsl */ `
  ${modesGLSL}
  uniform float dt, time, pull, jitter, kick, gravity;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + time) * 43758.5453); }
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv); vec3 v = texture2D(textureVelocity, uv).xyz;
    vec2 q = pos.xz;
    float e = 0.012;
    float u0 = plate(q), ux = plate(q + vec2(e, 0.0)), uy = plate(q + vec2(0.0, e));
    vec2 grad = vec2(ux - u0, uy - u0) / e;
    float onPlate = step(pos.y, 0.02);
    // la arena huele hacia donde la placa vibra menos: baja por el gradiente de u²
    vec2 f = -grad * u0 * pull * onPlate;
    f += (vec2(hash(uv), hash(uv.yx)) - 0.5) * jitter * (0.2 + abs(u0) * 3.0) * onPlate;
    v.xz = v.xz * (1.0 - 6.0 * dt * onPlate) + f * dt;
    v.y += (kick * (0.5 + hash(uv + 0.3)) * abs(u0) * 1.2 + kick * 0.12) * onPlate - gravity * dt;
    if (pos.y <= 0.0 && v.y < 0.0) v.y = -v.y * 0.25;
    float sp = length(v.xz); if (sp > 1.5) v.xz *= 1.5 / sp;
    gl_FragColor = vec4(v, 1.0);
  }
`;
const posShader = /* glsl */ `
  uniform float dt;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv); vec3 v = texture2D(textureVelocity, uv).xyz;
    vec3 p = pos.xyz + v * dt;
    p.xz = clamp(p.xz, -0.995, 0.995);
    p.y = max(p.y, 0.0);
    gl_FragColor = vec4(p, pos.w);
  }
`;
const sandVert = /* glsl */ `
  uniform sampler2D texturePosition, textureVelocity;
  uniform float pointSize, size, brightness;
  uniform vec3 colA, colB;
  varying vec3 vColor; varying float vA;
  void main() {
    vec4 pos = texture2D(texturePosition, uv);
    float sp = clamp(length(texture2D(textureVelocity, uv).xyz) * 1.5, 0.0, 1.0);
    vec3 p = vec3(pos.x * size, pos.y * size * 0.6 + 0.03, pos.z * size);
    vColor = mix(colA, colB, sp) * brightness * (1.0 + pos.y * 2.0);
    vA = 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = pointSize * (30.0 / max(-mv.z, 0.5));
    gl_Position = projectionMatrix * mv;
  }
`;
const sandFrag = /* glsl */ `varying vec3 vColor; varying float vA; void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.05, r) * vA; gl_FragColor = vec4(vColor * a, a); }`;
const plateVert = /* glsl */ `
  ${modesGLSL}
  uniform float amp;
  varying float vU; varying vec3 vN, vP;
  void main() {
    vec2 q = uv * 2.0 - 1.0;
    float e = 0.01;
    float u0 = plate(q), ux = plate(q + vec2(e, 0.0)), uy = plate(q + vec2(0.0, e));
    vec3 p = position; p.y += u0 * amp;
    vN = normalize(vec3(-(ux - u0) / e * amp, 1.0, -(uy - u0) / e * amp));
    vU = u0; vP = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const plateFrag = /* glsl */ `
  uniform vec3 colPlate, colGlow, lightDir;
  varying float vU; varying vec3 vN, vP;
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vP);
    float dif = 0.4 + 0.6 * max(0.0, dot(n, lightDir));
    float spec = pow(max(0.0, dot(reflect(-lightDir, n), v)), 60.0);
    float fres = pow(1.0 - max(0.0, dot(n, v)), 3.0);
    vec3 col = colPlate * dif + colGlow * (abs(vU) * 0.12) + spec * 0.3 + fres * colGlow * 0.05;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class CimaticaScene extends MusicScene {
  static id = 'cimatica';
  static title = 'Cimática';
  constructor(app) { super(app, 'cimatica', 'Cimática'); this.active = new Map(); this.ripple = 0; this.rippleT = 10; }

  defineParams() {
    super.defineParams();
    this.p('resolucion', { type: 'option', options: ['256', '512'], default: '512', label: 'granos de arena (n²)' });
    this.p('tamano', { min: 2, max: 12, default: 6, step: 0.01, label: 'tamaño de la placa' });
    this.p('atraccion', { min: 0, max: 30, default: 9, step: 0.01, label: 'atracción a las líneas nodales' });
    this.p('agitacion', { min: 0, max: 3, default: 0.8, step: 0.01, label: 'agitación' });
    this.p('sacudida', { min: 0, max: 3, default: 1, step: 0.01, label: 'sacudida en los kicks' });
    this.p('relieve', { min: 0, max: 0.6, default: 0.012, step: 0.001, label: 'relieve de la placa' });
    this.p('velMin', { min: 0, max: 1, default: 0.35, step: 0.01, label: 'fuerza mínima de nota' });
    this.p('grano', { min: 0.2, max: 6, default: 0.9, step: 0.01, label: 'tamaño del grano' });
    this.p('brillo', { min: 0, max: 2, default: 0.45, step: 0.005, label: 'brillo de la arena' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x05040a);
    s.fog = new THREE.FogExp2(0x05040a, 0.018);
    this.floor = new WetFloor({ size: 70, repeat: 10, puddles: 0.35, reflect: 0.7, color: 0x8890a0 }); this.floor.position.y = -0.6; this.floor.userData.helper = true; s.add(this.floor);
    s.add(new THREE.HemisphereLight(0x334466, 0x050508, 0.5));
    this.plateMat = new THREE.ShaderMaterial({
      uniforms: { modes: { value: Array.from({ length: MAXM }, () => new THREE.Vector3()) }, nModes: { value: 0 }, ripple: { value: 0 }, rippleT: { value: 10 }, amp: { value: 0.1 }, colPlate: { value: new THREE.Color(0x0c0a16) }, colGlow: { value: new THREE.Color() }, lightDir: { value: new THREE.Vector3(0.4, 1, 0.3).normalize() } },
      vertexShader: plateVert, fragmentShader: plateFrag, side: THREE.DoubleSide,
    });
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 160, 160), this.plateMat); this.plate.rotation.x = -Math.PI / 2; this.plate.name = 'placa';
    s.add(this.plate);
    this.buildSim(parseInt(this.v('resolucion'), 10));
    this.params.onChange((id, value) => { if (id === 'cimatica.resolucion') this.buildSim(parseInt(value, 10)); });
    this.subject.radius = 4; this.subject.distance = 10; this.subject.center.set(0, 0.5, 0);
    this.fixed = { pos: new THREE.Vector3(0, 5.2, 7.5), look: new THREE.Vector3(0, 0, -0.3), fov: 42 };
  }

  buildSim(size) {
    if (this.sand) { this.scene.remove(this.sand); this.sand.geometry.dispose(); this.sand.material.dispose(); this.gpu?.dispose?.(); }
    this.gpu = new GPUComputationRenderer(size, size, this.app.renderer);
    const pos0 = this.gpu.createTexture(), vel0 = this.gpu.createTexture(), d = pos0.image.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.random() * 2 - 1; d[i + 1] = 0; d[i + 2] = Math.random() * 2 - 1; d[i + 3] = Math.random(); }
    this.velVar = this.gpu.addVariable('textureVelocity', velShader, vel0);
    this.posVar = this.gpu.addVariable('texturePosition', posShader, pos0);
    this.gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    this.gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    const vu = this.velVar.material.uniforms, pu = this.posVar.material.uniforms;
    Object.assign(vu, { modes: { value: Array.from({ length: MAXM }, () => new THREE.Vector3()) }, nModes: { value: 0 }, ripple: { value: 0 }, rippleT: { value: 10 }, dt: { value: 0 }, time: { value: 0 }, pull: { value: 9 }, jitter: { value: 0.8 }, kick: { value: 0 }, gravity: { value: 3 } });
    pu.dt = { value: 0 };
    const err = this.gpu.init(); if (err) console.error('GPGPU:', err);
    const n = size * size, geo = new THREE.BufferGeometry(), uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uvs[i * 2] = ((i % size) + 0.5) / size; uvs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size; }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.sandMat = new THREE.ShaderMaterial({ uniforms: { texturePosition: { value: null }, textureVelocity: { value: null }, pointSize: { value: 1 }, size: { value: 3 }, brightness: { value: 1 }, colA: { value: new THREE.Color() }, colB: { value: new THREE.Color() } }, vertexShader: sandVert, fragmentShader: sandFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sand = new THREE.Points(geo, this.sandMat); this.sand.name = 'arena'; this.sand.frustumCulled = false;
    this.scene.add(this.sand);
  }

  /** Modo (n, m) de una nota: altura → pareja de enteros distinta por semitono. */
  modeOf(midi) { const i = midi - 36; return [1 + (i % 7), 1 + ((i * 3) >> 1) % 6 + (i % 2)]; }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), k = this.v2('fourier.intensidad'), sdt = Math.min(dt, 1 / 30);
    // notas activas (y las que vienen, insinuadas) → modos con envolvente
    const vmin = v('velMin'), now = c.t, L = this.lookahead;
    for (const n of c.notesActive) if (n.vel >= vmin && !this.active.has(n)) this.active.set(n, { a: 0, target: n.vel });
    for (const n of c.notesAhead(L * 0.5)) if (n.vel >= vmin && !this.active.has(n)) this.active.set(n, { a: 0, target: n.vel * 0.25 * Math.max(0, 1 - (n.t0 - now) / (L * 0.5)) });
    for (const [n, st] of this.active) {
      const on = n.t0 <= now && n.t1 > now;
      st.target = on ? n.vel : n.t0 > now ? n.vel * 0.25 * Math.max(0, 1 - (n.t0 - now) / (L * 0.5)) : 0;
      st.a += (st.target - st.a) * (1 - Math.exp(-dt * (st.target > st.a ? 18 : 3)));
      if (!on && n.t1 <= now && st.a < 0.01) this.active.delete(n);
    }
    const list = [...this.active.entries()].sort((a, b) => b[1].a - a[1].a).slice(0, MAXM);
    const setModes = (U) => { list.forEach(([n, st], i) => { const [nn, mm] = this.modeOf(n.midi); U.modes.value[i].set(nn, mm, st.a * 0.6); }); U.nModes.value = list.length; U.ripple.value = this.ripple; U.rippleT.value = this.rippleT; };
    // kick: onda radial + sacudida
    const kick = c.bands[0].hit > this.threshold ? c.bands[0].hit : 0;
    if (kick) { this.ripple = Math.max(this.ripple, kick * 1.2 * k); this.rippleT = 0; }
    this.rippleT += dt; this.ripple *= Math.exp(-dt * 1.5);
    const vu = this.velVar.material.uniforms, pu = this.posVar.material.uniforms;
    setModes(vu); setModes(this.plateMat.uniforms);
    vu.dt.value = sdt; vu.time.value = t; vu.pull.value = v('atraccion'); vu.jitter.value = v('agitacion') * (0.5 + c.loud); vu.kick.value = kick * v('sacudida') * k * 1.5; vu.gravity.value = 7;
    pu.dt.value = sdt;
    this.gpu.compute();
    const S = v('tamano') / 2;
    const u = this.sandMat.uniforms;
    u.texturePosition.value = this.gpu.getCurrentRenderTarget(this.posVar).texture; u.textureVelocity.value = this.gpu.getCurrentRenderTarget(this.velVar).texture;
    u.pointSize.value = v('grano') * this.app.renderer.getPixelRatio(); u.size.value = S; u.brightness.value = v('brillo') * (0.8 + this.flash * 0.5);
    const sec = c.section?.type ?? 0;
    u.colA.value.copy(this.sectionColor(sec, 0.65, 0.5)); u.colB.value.copy(this.sectionColor(sec + 1, 0.8, 0.9));
    this.plate.scale.setScalar(S); this.plateMat.uniforms.amp.value = v('relieve') * (1 + this.kick * 0.5);
    this.plateMat.uniforms.colGlow.value.copy(this.sectionColor(sec, 0.3, 0.8));
    this.subject.center.set(0, 0.4, 0); this.subject.radius = S * 0.9;
    this.finish(dt);
  }
}
