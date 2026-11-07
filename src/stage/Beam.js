import * as THREE from 'three';
import { simplexNoise3D } from '../shaders/noise.glsl.js';

/**
 * Haz volumétrico de un foco en el humo: cono analítico. Para cada píxel se
 * intersecta el rayo de la cámara con el cono (vértice, eje, ángulo, largo) y
 * se integra la luz a lo largo del tramo que queda adentro: cae con la
 * distancia al foco, se ablanda en el borde y respira con ruido (humo). Es
 * exacto por ojo y se ve desde adentro del haz.
 */
const vert = /* glsl */ `varying vec3 vWorld; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const frag = /* glsl */ `
  precision highp float;
  ${simplexNoise3D}
  uniform vec3 apex, axis, color;
  uniform float cosA, tanA, len, intensity, haze, time, falloff;
  varying vec3 vWorld;
  void main() {
    vec3 ro = cameraPosition, rd = normalize(vWorld - ro), co = ro - apex;
    float ra = dot(rd, axis), ca = dot(co, axis), c2 = cosA * cosA;
    float a = ra * ra - c2, b = 2.0 * (ra * ca - dot(rd, co) * c2), c = ca * ca - dot(co, co) * c2;
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0 || abs(a) < 1e-6) discard;
    float sq = sqrt(disc), t0 = (-b - sq) / (2.0 * a), t1 = (-b + sq) / (2.0 * a);
    if (t0 > t1) { float tmp = t0; t0 = t1; t1 = tmp; }
    // tramo del rayo con altura h = dot(p - apex, axis) entre 0 y len
    float lo = 0.0, hi = 1e9;
    if (abs(ra) > 1e-5) { float ta = -ca / ra, tb = (len - ca) / ra; lo = min(ta, tb); hi = max(ta, tb); } else if (ca < 0.0 || ca > len) discard;
    // F(t) = a t² + b t + c > 0 adentro del cono: con a < 0 es entre las raíces; con a > 0, afuera de ellas
    float tA, tB;
    if (a < 0.0) { tA = max(t0, lo); tB = min(t1, hi); }
    else { tA = max(t1, lo); tB = hi; if (tB <= tA) { tA = lo; tB = min(t0, hi); } }
    tA = max(tA, 0.0); tB = min(tB, length(vWorld - ro));
    if (tB <= tA) discard;
    float acc = 0.0; const int N = 12;
    for (int i = 0; i < N; i++) {
      float t = mix(tA, tB, (float(i) + 0.5) / float(N));
      vec3 p = ro + rd * t; vec3 d = p - apex; float h = dot(d, axis);
      float r = length(d - axis * h), R = max(0.05, h * tanA);
      float edge = 1.0 - smoothstep(0.55, 1.0, r / R);
      float dist = 1.0 / (1.0 + h * h * falloff);
      float n = 0.75 + 0.25 * snoise(p * 0.9 + vec3(0.0, -time * 0.35, time * 0.2)) + 0.12 * snoise(p * 3.0 + time * 0.6);
      acc += edge * dist * n;
    }
    float v = acc * (tB - tA) / float(N) * intensity * haze;
    gl_FragColor = vec4(color * v, 1.0);
  }
`;

export class Beam extends THREE.Mesh {
  constructor(o = {}) {
    const angle = o.angle ?? 0.2, len = o.length ?? 14;
    const geo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    geo.translate(0, -0.5, 0); geo.rotateX(-Math.PI / 2);   // vértice en el origen, apunta a +z local, radio 1 en z = 1
    super(geo, new THREE.ShaderMaterial({
      uniforms: { apex: { value: new THREE.Vector3() }, axis: { value: new THREE.Vector3(0, 0, 1) }, color: { value: new THREE.Color(o.color ?? 0xffffff) }, cosA: { value: Math.cos(angle) }, tanA: { value: Math.tan(angle) }, len: { value: len }, intensity: { value: o.intensity ?? 1 }, haze: { value: o.haze ?? 0.5 }, time: { value: 0 }, falloff: { value: o.falloff ?? 0.012 } },
      vertexShader: vert, fragmentShader: frag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    }));
    this.name = 'haz'; this.userData.helper = true; this.renderOrder = 10; this.frustumCulled = false;
    this.angle = angle; this.len = len;
    this.setAngle(angle); this.setLength(len);
  }
  setAngle(a) { this.angle = a; this.material.uniforms.cosA.value = Math.cos(a); this.material.uniforms.tanA.value = Math.tan(a); this.updateScale(); }
  setLength(l) { this.len = l; this.material.uniforms.len.value = l; this.updateScale(); }
  updateScale() { const r = Math.tan(this.angle) * this.len * 1.15; this.scale.set(r, r, this.len * 1.05); }
  /** Llamar después de mover el foco: toma vértice y eje del mundo. */
  sync(time) {
    this.updateWorldMatrix(true, false);
    const u = this.material.uniforms;
    u.apex.value.setFromMatrixPosition(this.matrixWorld);
    u.axis.value.set(0, 0, 1).transformDirection(this.matrixWorld).normalize();
    u.time.value = time;
  }
  set(color, intensity, haze) { const u = this.material.uniforms; u.color.value.copy(color); u.intensity.value = intensity; u.haze.value = haze; this.visible = intensity > 0.002; }
}
