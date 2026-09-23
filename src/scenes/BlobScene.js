import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';
import { simplexNoise3D } from '../shaders/noise.glsl.js';

/**
 * Metaballs raymarcheadas (superficies fluidas que se funden). Todo ocurre en
 * un shader de pantalla completa; los rayos se construyen desde la matriz de
 * proyección de la cámara de cada ojo, así que el estéreo (off-axis) es exacto.
 */
const vert = /* glsl */ `
  varying vec2 vNdc;
  void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
  precision highp float;
  ${simplexNoise3D}
  varying vec2 vNdc;
  uniform mat4 projInv, camWorld;
  uniform float time, smoothK, size, spread, speed, wobble, hue, sat, gloss, floorY, showFloor;
  uniform float depthMode, dNear, dFar;
  uniform int count;
  uniform vec3 lightDir;

  vec3 hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

  vec3 blobPos(int i) {
    float f = float(i);
    float t = time * speed;
    return vec3(
      sin(t * 0.7 + f * 1.7) * cos(t * 0.3 + f) ,
      sin(t * 0.5 + f * 2.3) * 0.8,
      cos(t * 0.6 + f * 1.1) * sin(t * 0.25 + f * 0.7)
    ) * spread;
  }

  float map(vec3 p) {
    float d = 1e5;
    for (int i = 0; i < 12; i++) {
      if (i >= count) break;
      float r = size * (0.7 + 0.3 * sin(float(i) * 3.1 + time * 0.9));
      d = smin(d, length(p - blobPos(i)) - r, smoothK);
    }
    if (wobble > 0.0) d += snoise(p * 1.5 + time * 0.4) * wobble * 0.3;
    if (showFloor > 0.5) d = smin(d, p.y - floorY, smoothK * 0.5);
    return d;
  }

  vec3 normal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
  }

  float ao(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 1; i <= 5; i++) { float h = 0.05 * float(i); occ += (h - map(p + n * h)) * sca; sca *= 0.7; }
    return clamp(1.0 - 2.0 * occ, 0.0, 1.0);
  }

  void main() {
    vec4 v = projInv * vec4(vNdc, 1.0, 1.0);
    vec3 dirView = normalize(v.xyz / v.w);
    vec3 rd = normalize((camWorld * vec4(dirView, 0.0)).xyz);
    vec3 ro = camWorld[3].xyz;

    float t = 0.0, d = 0.0;
    bool hit = false;
    for (int i = 0; i < 128; i++) {
      d = map(ro + rd * t);
      if (d < 0.001 * t) { hit = true; break; }
      t += d * 0.85;
      if (t > 80.0) break;
    }

    vec3 bgTop = hsv2rgb(vec3(hue + 0.55, 0.5, 0.18)), bgBot = hsv2rgb(vec3(hue + 0.65, 0.6, 0.04));
    vec3 col = mix(bgBot, bgTop, rd.y * 0.5 + 0.5);
    if (depthMode > 0.5) {
      float g = hit ? 1.0 - clamp((t - dNear) / (dFar - dNear), 0.0, 1.0) : 0.0;
      gl_FragColor = vec4(vec3(g), 1.0); return;
    }
    if (hit) {
      vec3 p = ro + rd * t;
      vec3 n = normal(p);
      float isFloor = showFloor > 0.5 ? smoothstep(0.15, 0.0, abs(p.y - floorY)) : 0.0;
      vec3 base = hsv2rgb(vec3(hue + n.y * 0.08 + p.x * 0.01, sat, 0.95));
      base = mix(base, hsv2rgb(vec3(hue + 0.5, sat * 0.4, 0.55)), isFloor);
      float dif = clamp(dot(n, lightDir), 0.0, 1.0);
      float fill = clamp(dot(n, normalize(vec3(-lightDir.x, 0.3, -lightDir.z))), 0.0, 1.0) * 0.35;
      float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
      vec3 h = normalize(lightDir - rd);
      float spec = pow(clamp(dot(n, h), 0.0, 1.0), 16.0 + gloss * 200.0) * gloss;
      float occ = ao(p, n);
      col = base * (0.25 + 0.75 * dif + fill) * occ + rim * 0.35 * hsv2rgb(vec3(hue + 0.5, 0.6, 1.0)) + spec;
      col = mix(col, bgBot, 1.0 - exp(-0.0006 * t * t));
    }
    // los colores están pensados en sRGB; la salida final los vuelve a codificar
    gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
  }
`;

export class BlobScene extends BaseScene {
  static id = 'blob';
  constructor(app) { super(app, 'blob', 'Metaballs'); this.orbit = 0; this.handlesDepthLook = true; }

  defineParams() {
    this.p('count', { min: 1, max: 12, default: 7, step: 1, label: 'cantidad' });
    this.p('smoothK', { min: 0.05, max: 3, default: 0.9, step: 0.01, label: 'fusión' });
    this.p('size', { min: 0.2, max: 3, default: 1.1, step: 0.01, label: 'tamaño' });
    this.p('spread', { min: 0, max: 8, default: 2.5, step: 0.01, label: 'dispersión' });
    this.p('speed', { min: 0, max: 4, default: 0.8, step: 0.01, label: 'velocidad' });
    this.p('wobble', { min: 0, max: 2, default: 0.2, step: 0.01, label: 'ondulación superficie' });
    this.p('hue', { min: 0, max: 1, default: 0.93, step: 0.001, label: 'color' });
    this.p('sat', { min: 0, max: 1, default: 0.6, step: 0.001, label: 'saturación' });
    this.p('gloss', { min: 0, max: 1, default: 0.5, step: 0.001, label: 'brillo especular' });
    this.p('floor', { default: true, label: 'piso' });
    this.p('floorY', { min: -8, max: 0, default: -3.5, step: 0.01, label: 'altura piso' });
    this.p('lightAngle', { min: 0, max: 360, default: 40, step: 0.1, label: 'ángulo luz' });
    this.p('orbit', { min: -30, max: 30, default: 3, step: 0.1, label: 'órbita cámara (°/s)' });
    this.p('distance', { min: 3, max: 30, default: 11, step: 0.01, label: 'distancia cámara' });
    this.p('height', { min: -5, max: 10, default: 1.5, step: 0.01, label: 'altura cámara' });
    this.p('fov', { min: 15, max: 100, default: 45, step: 0.1, label: 'fov' });
  }

  build() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
        time: { value: 0 }, smoothK: { value: 1 }, size: { value: 1 }, spread: { value: 2 }, speed: { value: 1 },
        wobble: { value: 0 }, hue: { value: 0 }, sat: { value: 0.5 }, gloss: { value: 0.5 }, floorY: { value: -3 }, showFloor: { value: 1 },
        depthMode: { value: 0 }, dNear: { value: 4 }, dFar: { value: 20 }, count: { value: 7 },
        lightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      },
      vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quad.onBeforeRender = (_r, _s, camera) => {
      this.material.uniforms.projInv.value.copy(camera.projectionMatrix).invert();
      this.material.uniforms.camWorld.value.copy(camera.matrixWorld);
    };
    this.scene.add(this.quad);
  }

  update(dt, t) {
    const v = (n) => this.v(n);
    const u = this.material.uniforms;
    u.time.value = t; u.count.value = Math.round(v('count')); u.smoothK.value = v('smoothK'); u.size.value = v('size');
    u.spread.value = v('spread'); u.speed.value = v('speed'); u.wobble.value = v('wobble'); u.hue.value = v('hue');
    u.sat.value = v('sat'); u.gloss.value = v('gloss'); u.floorY.value = v('floorY'); u.showFloor.value = v('floor') ? 1 : 0;
    const la = THREE.MathUtils.degToRad(v('lightAngle'));
    u.lightDir.value.set(Math.sin(la), 0.8, Math.cos(la)).normalize();
    u.depthMode.value = this.params.get('look.depth') ? 1 : 0;
    u.dNear.value = this.params.get('look.depthNear'); u.dFar.value = this.params.get('look.depthFar');

    this.orbit += v('orbit') * dt;
    const az = THREE.MathUtils.degToRad(this.orbit), d = v('distance');
    this.camera.position.set(Math.sin(az) * d, v('height'), Math.cos(az) * d);
    this.camera.lookAt(0, 0, 0);
    this.camera.fov = v('fov');
  }
}
