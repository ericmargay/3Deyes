import * as THREE from 'three';

/**
 * Escena base. Cada escena:
 *  - define sus parámetros en defineParams() con el prefijo de su grupo (this.key)
 *  - construye objetos en build()
 *  - anima en update(dt, t)
 *  - libera en dispose()
 *
 * La cámara es una PerspectiveCamera normal; el StereoOutput deriva de ella
 * las dos cámaras de ojo. `camera.focus` = plano de convergencia (se controla
 * con stereo.focus). Todo lo que esté más cerca que focus "sale" del mural y
 * lo que esté más lejos "entra".
 */
export class BaseScene {
  constructor(app, key, title) {
    this.app = app;
    this.params = app.params;
    this.key = key;
    this.title = title;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 0, 12);
    this.clock = 0;
    this.built = false;
  }

  /** helper: define un parámetro del grupo de la escena */
  p(name, opts) { return this.params.define(`${this.key}.${name}`, opts); }
  /** helper: lee un parámetro del grupo */
  v(name) { return this.params.get(`${this.key}.${name}`); }

  defineParams() {}
  build() {}
  update(_dt, _t) {}
  onParam(_name, _value) {}

  enter() {
    if (!this.built) { this.defineParams(); this.build(); this.built = true; }
  }
  exit() {}

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}

/**
 * "Depth look": renderiza la escena como mapa de profundidad (blanco cerca,
 * negro lejos), como en las imágenes de referencia. Se implementa como
 * material override sobre MeshDepthMaterial, así funciona con instancias,
 * skinning, etc.
 */
export class DepthLook {
  constructor(params) {
    this.params = params;
    this.uniforms = { dNear: { value: 6 }, dFar: { value: 26 }, dGamma: { value: 1 }, dInvert: { value: 0 } };
    this.material = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float dNear; uniform float dFar; uniform float dGamma; uniform float dInvert;\nvoid main() {')
        .replace(
          /gl_FragColor = vec4\( vec3\( 1\.0 - fragCoordZ \), opacity \);/,
          `float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
           float d = clamp( ( -viewZ - dNear ) / ( dFar - dNear ), 0.0, 1.0 );
           float g = pow( 1.0 - d, dGamma );
           g = mix( g, 1.0 - g, dInvert );
           gl_FragColor = vec4( vec3( g ), 1.0 );`
        )
        .replace('#include <packing>', '#include <packing>\nuniform float cameraNear; uniform float cameraFar;');
      shader.uniforms.cameraNear = this.cameraNear = { value: 0.1 };
      shader.uniforms.cameraFar = this.cameraFar = { value: 200 };
    };
    params.define('look.depth', { default: false, label: 'mapa de profundidad' });
    params.define('look.depthNear', { min: 0, max: 50, default: 6, step: 0.01, label: 'prof. cerca' });
    params.define('look.depthFar', { min: 1, max: 100, default: 26, step: 0.01, label: 'prof. lejos' });
    params.define('look.depthGamma', { min: 0.2, max: 4, default: 1, step: 0.01, label: 'prof. gamma' });
    params.define('look.depthInvert', { default: false, label: 'prof. invertir' });
  }

  /** Aplica / quita el override antes de renderizar. */
  apply(scene, camera) {
    const on = this.params.get('look.depth');
    scene.overrideMaterial = on ? this.material : null;
    if (!on) return;
    this.uniforms.dNear.value = this.params.get('look.depthNear');
    this.uniforms.dFar.value = Math.max(this.params.get('look.depthNear') + 0.01, this.params.get('look.depthFar'));
    this.uniforms.dGamma.value = this.params.get('look.depthGamma');
    this.uniforms.dInvert.value = this.params.get('look.depthInvert') ? 1 : 0;
    if (this.cameraNear) { this.cameraNear.value = camera.near; this.cameraFar.value = camera.far; }
  }
}
