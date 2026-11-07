import * as THREE from 'three';
import { MusicScene } from './MusicScene.js';
import { simplexNoise3D } from '../../shaders/noise.glsl.js';

/**
 * GELATINA: una gelatina 3D brillante (raymarch) que se aplasta con el kick,
 * se hincha con los 808 largos (promedio lento del sub), tiembla con los
 * medios y lanza gotas con cajas y platillos. Las gotas caen, rebotan y se
 * funden con el cuerpo. Los rayos salen de la proyección de cada ojo: el
 * estéreo es exacto.
 */
const MAXD = 24;
const vert = /* glsl */ `varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const frag = /* glsl */ `
  precision highp float;
  ${simplexNoise3D}
  varying vec2 vNdc;
  uniform mat4 projInv, camWorld;
  uniform float time, radius, floorY, gloss, wob1, wob2, wob3, wob4, rim;
  uniform vec3 squash, colA, colB, colRim, colFloor, lightDir;
  uniform vec3 drops[${MAXD}]; uniform float dropR[${MAXD}]; uniform int nDrops;
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  float jelly(vec3 p) {
    vec3 q = p / squash;
    float r = length(q); vec3 n = q / max(r, 1e-4);
    float az = atan(n.z, n.x), el = n.y;
    float def = wob1 * sin(3.0 * az + time * 2.3) * (1.0 - el * el)
              + wob2 * sin(5.0 * el * 2.0 + time * 3.1) * 0.6
              + wob3 * sin(7.0 * az - time * 4.0) * (1.0 - el * el) * 0.5
              + wob4 * snoise(n * 2.5 + time * 0.8) * 0.8;
    return (r - radius * (1.0 + def)) * min(squash.x, squash.y) * 0.9;
  }
  float map(vec3 p) {
    float d = jelly(p);
    for (int i = 0; i < ${MAXD}; i++) { if (i >= nDrops) break; d = smin(d, length(p - drops[i]) - dropR[i], 0.28); }
    d = smin(d, p.y - floorY, 0.35);
    return d;
  }
  vec3 normal(vec3 p) { vec2 e = vec2(0.003, 0.0); return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx))); }
  float ao(vec3 p, vec3 n) { float o = 0.0, s = 1.0; for (int i = 1; i <= 5; i++) { float h = 0.06 * float(i); o += (h - map(p + n * h)) * s; s *= 0.7; } return clamp(1.0 - 2.2 * o, 0.0, 1.0); }
  vec3 env(vec3 d) { float u = d.y * 0.5 + 0.5; vec3 c = mix(colFloor * 0.4, colB, smoothstep(0.1, 0.55, u)); c = mix(c, colA * 1.3, smoothstep(0.6, 1.0, u)); c += colRim * pow(max(0.0, dot(d, lightDir)), 40.0) * 3.0; return c; }
  void main() {
    vec4 v = projInv * vec4(vNdc, 1.0, 1.0);
    vec3 rd = normalize((camWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz), ro = camWorld[3].xyz;
    float t = 0.0, d; bool hit = false;
    for (int i = 0; i < 110; i++) { d = map(ro + rd * t); if (d < 0.0015 * t) { hit = true; break; } t += d * 0.9; if (t > 60.0) break; }
    vec3 col = env(rd) * 0.25;
    if (hit) {
      vec3 p = ro + rd * t, n = normal(p);
      float isFloor = smoothstep(0.25, 0.0, abs(p.y - floorY));
      float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
      float dif = clamp(dot(n, lightDir), 0.0, 1.0);
      float occ = ao(p, n);
      vec3 base = mix(colA, colB, 0.5 + 0.5 * n.y);
      // "subsuperficie": luz que atraviesa la gelatina
      float back = clamp(dot(-n, lightDir) * 0.5 + 0.5, 0.0, 1.0);
      vec3 body = base * (0.35 + 0.65 * dif) + colB * back * 0.35;
      vec3 refl = env(reflect(rd, n));
      vec3 h = normalize(lightDir - rd);
      float spec = pow(clamp(dot(n, h), 0.0, 1.0), 20.0 + gloss * 300.0) * (0.3 + gloss);
      vec3 jel = mix(body, refl, 0.25 + 0.6 * fres) + spec + colRim * fres * rim;
      vec3 flo = colFloor * (0.3 + 0.7 * dif) + refl * 0.15 * (1.0 - fres);
      col = mix(jel, flo, isFloor) * occ;
      col = mix(col, env(rd) * 0.25, 1.0 - exp(-0.0008 * t * t));
    }
    gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
  }
`;

export class GelatinaScene extends MusicScene {
  static id = 'gelatina';
  static title = 'Gelatina';
  constructor(app) { super(app, 'gelatina', 'Gelatina'); this.handlesDepthLook = false; this.drops = []; this.sq = { y: 1, vy: 0 }; this.subAvg = 0; }

  defineParams() {
    super.defineParams();
    this.p('radio', { min: 0.5, max: 4, default: 1.7, step: 0.01, label: 'radio' });
    this.p('aplastar', { min: 0, max: 2, default: 1, step: 0.01, label: 'aplastar en el kick' });
    this.p('hinchar', { min: 0, max: 1, default: 0.35, step: 0.01, label: 'hinchar con los 808' });
    this.p('temblor', { min: 0, max: 2, default: 1, step: 0.01, label: 'temblor (medios)' });
    this.p('gotas', { min: 0, max: 2, default: 1, step: 0.01, label: 'gotas (cajas y platillos)' });
    this.p('brillo', { min: 0, max: 1, default: 0.75, step: 0.01, label: 'brillo (gloss)' });
    this.p('piso', { min: -6, max: 0, default: -2.4, step: 0.01, label: 'altura del piso' });
    this.p('luz', { min: 0, max: 360, default: 35, step: 0.5, label: 'ángulo de la luz' });
  }

  build() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, time: { value: 0 }, radius: { value: 1.7 }, floorY: { value: -2.4 }, gloss: { value: 0.7 },
        wob1: { value: 0 }, wob2: { value: 0 }, wob3: { value: 0 }, wob4: { value: 0 }, rim: { value: 0.6 },
        squash: { value: new THREE.Vector3(1, 1, 1) }, colA: { value: new THREE.Color() }, colB: { value: new THREE.Color() }, colRim: { value: new THREE.Color() }, colFloor: { value: new THREE.Color(0.05, 0.04, 0.09) },
        lightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        drops: { value: Array.from({ length: MAXD }, () => new THREE.Vector3(0, -99, 0)) }, dropR: { value: new Float32Array(MAXD) }, nDrops: { value: 0 },
      },
      vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material); this.quad.name = 'gelatina (raymarch)'; this.quad.frustumCulled = false;
    this.quad.onBeforeRender = (_r, _s, camera) => { this.material.uniforms.projInv.value.copy(camera.projectionMatrix).invert(); this.material.uniforms.camWorld.value.copy(camera.matrixWorld); };
    this.scene.add(this.quad);
    this.subject.radius = 3; this.subject.distance = 9;
    this.fixed = { pos: new THREE.Vector3(0, 0.6, 8), look: new THREE.Vector3(0, -0.5, 0), fov: 40 };
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), k = this.v2('fourier.intensidad'), u = this.material.uniforms;
    // aplastar: resorte en y con impulso en el kick
    const kick = c.bands[0].hit > this.threshold ? c.bands[0].hit : 0;
    if (kick) this.sq.vy -= kick * 7 * v('aplastar') * k;
    const sp = this.sq; sp.vy += (1 - sp.y) * 90 * dt - sp.vy * 7 * dt; sp.y += sp.vy * dt; sp.y = Math.max(0.45, sp.y);
    const sx = 1 / Math.sqrt(sp.y);
    u.squash.value.set(sx, sp.y, sx);
    // hinchar: promedio lento del sub
    this.subAvg += (c.bands[0].env - this.subAvg) * (1 - Math.exp(-dt * 1.5));
    u.radius.value = v('radio') * (1 + this.subAvg * v('hinchar'));
    // temblor con los medios, textura con el aire
    const tr = v('temblor') * k;
    u.wob1.value = 0.04 * tr * (0.3 + c.bands[2].env) + c.bands[1].pulse * 0.05 * tr;
    u.wob2.value = 0.03 * tr * c.bands[2].pulse; u.wob3.value = 0.025 * tr * c.bands[3].env; u.wob4.value = 0.02 * tr * c.bands[4].env;
    // gotas: cajas (medio / agudo) y platillos (aire)
    const g = v('gotas');
    for (const band of [2, 3, 4]) {
      const h = c.bands[band].hit;
      if (h > this.threshold && g > 0 && this.drops.length < MAXD) {
        const th = Math.random() * 6.283, ph = Math.acos(Math.random() * 0.9), R = u.radius.value;
        const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
        this.drops.push({ p: dir.clone().multiplyScalar(R * 0.9), v: dir.multiplyScalar(3 + 5 * h * g).add(new THREE.Vector3(0, 3 * h, 0)), r: (0.12 + 0.22 * h) * (band === 4 ? 0.6 : 1), life: 2.5, bounced: false });
      }
    }
    const floor = v('piso');
    for (const d of this.drops) {
      d.v.y -= 9 * dt; d.p.addScaledVector(d.v, dt); d.life -= dt;
      if (d.p.y - d.r < floor + 0.05 && d.v.y < 0) { if (!d.bounced) { d.v.y *= -0.45; d.v.x *= 0.7; d.v.z *= 0.7; d.bounced = true; } else { d.v.set(0, 0, 0); d.p.y = floor + d.r * 0.6; d.life = Math.min(d.life, 0.6); } }
      if (d.life < 0.5) d.r *= Math.max(0, d.life / 0.5) ** 0.3;
    }
    this.drops = this.drops.filter((d) => d.life > 0);
    this.drops.forEach((d, i) => { u.drops.value[i].copy(d.p); u.dropR.value[i] = d.r; });
    u.nDrops.value = this.drops.length;
    u.floorY.value = floor; u.gloss.value = v('brillo'); u.time.value = t; u.rim.value = 0.5 + this.flash * 0.8;
    const la = THREE.MathUtils.degToRad(v('luz')); u.lightDir.value.set(Math.sin(la), 0.8, Math.cos(la)).normalize();
    const sec = c.section?.type ?? 0;
    u.colA.value.copy(this.sectionColor(sec, 0.55, 0.85)); u.colB.value.copy(this.sectionColor(sec + 2, 0.35, 0.8)); u.colRim.value.copy(this.sectionColor(sec + 1, 0.7, 0.9)).multiplyScalar(1 + this.kick);
    u.colFloor.value.copy(this.sectionColor(sec, 0.08, 0.5));
    this.subject.center.set(0, -0.3, 0);
    this.finish(dt);
  }
}
