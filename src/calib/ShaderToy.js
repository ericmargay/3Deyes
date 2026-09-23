import * as THREE from 'three';

/**
 * Envuelve un shader estilo Shadertoy (mainImage) en una escena de un solo
 * quad. Se renderiza a través del StereoOutput como cualquier escena, así el
 * mural muestra exactamente la disposición de ojos elegida.
 *
 * Uniforms disponibles: iResolution, iTime, iTimeDelta, iFrame, iMouse, iDate.
 */
const HEADER = /* glsl */ `
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
#define texture2D texture
`;
const FOOTER = /* glsl */ `
out vec4 outColor;
void main() { vec4 c = vec4(0.0); mainImage(c, gl_FragCoord.xy); outColor = c; }
`;

export class ShaderToy {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.z = 5;
    this.uniforms = {
      iResolution: { value: new THREE.Vector3(1, 1, 1) },
      iTime: { value: 0 }, iTimeDelta: { value: 0 }, iFrame: { value: 0 },
      iMouse: { value: new THREE.Vector4() }, iDate: { value: new THREE.Vector4() },
    };
    this.material = null;
    this.error = null;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0 }));
    this.quad.frustumCulled = false;
    this.quad.onBeforeRender = (r) => {
      const t = r.getRenderTarget();
      const w = t ? t.width : r.domElement.width, h = t ? t.height : r.domElement.height;
      this.uniforms.iResolution.value.set(w, h, 1);
    };
    this.scene.add(this.quad);
    this.handlesDepthLook = true;
  }

  /** Compila el código; devuelve null si está bien o el texto del error. */
  setSource(src) {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: HEADER + src + FOOTER,
      depthTest: false, depthWrite: false,
    });
    const err = this.compileCheck(mat);
    if (err) { mat.dispose(); this.error = err; return err; }
    if (this.material) this.material.dispose();
    this.material = mat;
    this.quad.material = mat;
    this.error = null;
    return null;
  }

  compileCheck(mat) {
    const r = this.renderer;
    const test = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const s = new THREE.Scene(); s.add(test);
    const rt = new THREE.WebGLRenderTarget(4, 4);
    const prev = r.getRenderTarget();
    const silent = console.error; console.error = () => {};
    let err = null;
    try {
      r.setRenderTarget(rt); r.render(s, this.camera);
      const props = r.properties.get(mat);
      const d = props.currentProgram?.diagnostics;
      if (d && d.runnable === false) err = (d.fragmentShader?.log || d.programLog || 'error de compilación').trim();
    } catch (e) { err = e.message; } finally {
      console.error = silent; r.setRenderTarget(prev); rt.dispose(); test.geometry.dispose();
    }
    return err;
  }

  update(dt, t) {
    const u = this.uniforms;
    u.iTime.value = t; u.iTimeDelta.value = dt; u.iFrame.value++;
    const d = new Date();
    u.iDate.value.set(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds());
  }
}
