import * as THREE from 'three';

/**
 * Corner-pin (homografía) para ajustar la imagen final a la superficie
 * proyectada (mural, pared irregular, proyector en ángulo).
 *
 * Tecla P activa el modo edición: aparecen 4 manijas arrastrables.
 * La calibración se guarda en localStorage por separado de los parámetros.
 */
const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const frag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D map;
  uniform mat3 hInv;
  uniform float edit;
  void main() {
    vec3 p = hInv * vec3(vUv, 1.0);
    vec2 s = p.xy / p.z;
    vec3 col = vec3(0.0);
    if (all(greaterThanEqual(s, vec2(0.0))) && all(lessThanEqual(s, vec2(1.0)))) {
      col = texture2D(map, s).rgb;
      if (edit > 0.5) {
        // cuadrícula de calibración
        vec2 g = abs(fract(s * 8.0) - 0.5);
        float line = step(0.48, max(g.x, g.y));
        col = mix(col, vec3(1.0, 0.3, 0.6), line * 0.6);
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class CornerPin {
  constructor(renderer) {
    this.renderer = renderer;
    this.corners = [new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1), new THREE.Vector2(0, 1)];
    this.edit = false;
    this.rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType });
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.rt.texture }, hInv: { value: new THREE.Matrix3() }, edit: { value: 0 } },
      vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.handles = [];
    this.load();
    this.buildHandles();
    this.updateMatrix();
  }

  get active() { return this.edit || !this.isIdentity(); }

  isIdentity() {
    const c = this.corners;
    return c[0].x === 0 && c[0].y === 0 && c[1].x === 1 && c[1].y === 0 && c[2].x === 1 && c[2].y === 1 && c[3].x === 0 && c[3].y === 1;
  }

  reset() { this.corners[0].set(0, 0); this.corners[1].set(1, 0); this.corners[2].set(1, 1); this.corners[3].set(0, 1); this.updateMatrix(); this.save(); }

  /** Homografía del cuadrado unidad a los 4 puntos (Heckbert). */
  updateMatrix() {
    const [p0, p1, p2, p3] = this.corners;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, h;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
      d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y; g = 0; h = 0;
    } else {
      const den = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
      a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
      d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
    }
    const H = new THREE.Matrix3().set(a, b, c, d, e, f, g, h, 1);
    this.material.uniforms.hInv.value.copy(H).invert();
    this.positionHandles();
  }

  buildHandles() {
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'cp-handle';
      el.title = `esquina ${i}`;
      document.body.appendChild(el);
      let dragging = false;
      el.addEventListener('pointerdown', (ev) => { dragging = true; el.setPointerCapture(ev.pointerId); ev.preventDefault(); });
      el.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        this.corners[i].set(ev.clientX / window.innerWidth, 1 - ev.clientY / window.innerHeight);
        this.updateMatrix();
      });
      el.addEventListener('pointerup', () => { dragging = false; this.save(); });
      this.handles.push(el);
    }
  }

  positionHandles() {
    this.corners.forEach((c, i) => {
      const el = this.handles[i];
      el.style.left = `${c.x * window.innerWidth}px`;
      el.style.top = `${(1 - c.y) * window.innerHeight}px`;
      el.style.display = this.edit ? 'block' : 'none';
    });
  }

  setEdit(on) { this.edit = on; this.material.uniforms.edit.value = on ? 1 : 0; this.positionHandles(); }

  /** Asegura que el render target tenga el tamaño del canvas. */
  ensureSize(W, H) { if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H); }

  render() {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }

  save() { try { localStorage.setItem('3deyes.cornerpin', JSON.stringify(this.corners.map((c) => [c.x, c.y]))); } catch (_) { /* */ } }
  load() {
    try {
      const s = localStorage.getItem('3deyes.cornerpin');
      if (s) JSON.parse(s).forEach((v, i) => this.corners[i].set(v[0], v[1]));
    } catch (_) { /* */ }
  }
}
