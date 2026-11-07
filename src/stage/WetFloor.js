import * as THREE from 'three';

/**
 * Piso mojado: asfalto / hormigón con charcos que reflejan la escena.
 *
 * Material PBR normal (recibe las luces de área, focos y puntuales) al que se
 * le inyecta un reflejo planar: antes de dibujar el piso se renderiza la
 * escena desde la cámara reflejada (con plano de recorte oblicuo, como el
 * Reflector de three) y el fragmento mezcla ese reflejo según la máscara de
 * charcos y el ángulo de visión (Fresnel). Funciona por ojo: cada cámara
 * estéreo genera su propio reflejo.
 */
const _reflectorWorldPosition = new THREE.Vector3(), _cameraWorldPosition = new THREE.Vector3(), _rotationMatrix = new THREE.Matrix4();
const _lookAtPosition = new THREE.Vector3(0, 0, -1), _clipPlane = new THREE.Vector4(), _view = new THREE.Vector3(), _target = new THREE.Vector3(), _q = new THREE.Vector4();
const _normal = new THREE.Vector3(), _plane = new THREE.Plane();

function noiseCanvas(size, fn) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
  // ruido de valor en octavas (suave) para charcos y manchas
  const grid = (s) => { const g = new Float32Array(s * s); for (let i = 0; i < g.length; i++) g[i] = Math.random(); return g; };
  const octs = [[8, 1], [16, 0.5], [32, 0.25], [64, 0.125], [128, 0.06]].map(([s, w]) => ({ s, w, g: grid(s) }));
  const sample = (x, y) => {
    let v = 0, tot = 0;
    for (const o of octs) {
      const fx = (x / size) * o.s, fy = (y / size) * o.s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const g = (i, j) => o.g[((j % o.s) + o.s) % o.s * o.s + ((i % o.s) + o.s) % o.s];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx, b = g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx;
      v += (a * (1 - sy) + b * sy) * o.w; tot += o.w;
    }
    return v / tot;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const [r, g, b] = fn(sample(x, y), x, y, size); const i = (y * size + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class WetFloor extends THREE.Mesh {
  /**
   * @param {object} o  size (m), repeat, puddles 0..1 (cuánto charco; ≥ 1.6 = espejo entero), color, textureWidth/Height del reflejo
   */
  constructor(o = {}) {
    const size = o.size ?? 60, rep = o.repeat ?? 12;
    const albedo = noiseCanvas(512, (n) => { const v = 38 + n * 70 + (Math.random() - 0.5) * 18; return [v, v * 0.98, v * 1.02]; });
    const puddle = o.puddles ?? 0.5;
    const rough = noiseCanvas(512, (n) => { const wet = n > 1 - puddle * 0.65 ? 1 : Math.max(0, (n - (1 - puddle * 0.65 - 0.08)) / 0.08); const r = (1 - wet) * (120 + n * 110) + wet * 8; return [255 - wet * 255, r, 0]; });  // R: 1 - charco · G: rugosidad
    albedo.repeat.set(rep, rep); rough.repeat.set(rep, rep);
    albedo.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: o.color ?? 0xffffff, map: albedo, roughnessMap: rough, roughness: 1, metalness: 0.05 });
    super(new THREE.PlaneGeometry(size, size), mat);
    this.rotation.x = -Math.PI / 2; this.name = 'piso mojado';
    this.renderTarget = new THREE.WebGLRenderTarget(o.textureWidth ?? 1024, o.textureHeight ?? 512, { type: THREE.HalfFloatType });
    this.textureMatrix = new THREE.Matrix4();
    this.virtualCamera = new THREE.PerspectiveCamera();
    this.uniforms = { tReflect: { value: this.renderTarget.texture }, reflectMatrix: { value: this.textureMatrix }, tPuddle: { value: rough }, reflectAmt: { value: o.reflect ?? 0.8 }, puddleRepeat: { value: rep } };
    this.enabled = true;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 reflectMatrix; varying vec4 vReflectUv; varying vec2 vFloorUv;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvReflectUv = reflectMatrix * modelMatrix * vec4(position, 1.0); vFloorUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tReflect, tPuddle; uniform float reflectAmt, puddleRepeat; varying vec4 vReflectUv; varying vec2 vFloorUv;')
        .replace('#include <opaque_fragment>', `
          {
            vec3 refl = texture2DProj(tReflect, vReflectUv).rgb;
            float wet = 1.0 - texture2D(tPuddle, vFloorUv * puddleRepeat).r;
            vec3 nV = normalize(vNormal), vV = normalize(vViewPosition);
            float fres = pow(1.0 - clamp(dot(nV, vV), 0.0, 1.0), 2.5);
            float k = reflectAmt * mix(0.025, 1.0, wet * wet) * (0.15 + 0.85 * fres);
            outgoingLight = mix(outgoingLight, refl, clamp(k, 0.0, 0.96));
          }
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'wetfloor';
    this.onBeforeRender = (renderer, scene, camera) => this.renderReflection(renderer, scene, camera);
  }

  renderReflection(renderer, scene, camera) {
    if (!this.enabled) return;
    _reflectorWorldPosition.setFromMatrixPosition(this.matrixWorld);
    _cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    _rotationMatrix.extractRotation(this.matrixWorld);
    _normal.set(0, 0, 1).applyMatrix4(_rotationMatrix);
    _view.subVectors(_reflectorWorldPosition, _cameraWorldPosition);
    if (_view.dot(_normal) > 0) return;   // cámara debajo del piso
    _view.reflect(_normal).negate().add(_reflectorWorldPosition);
    _rotationMatrix.extractRotation(camera.matrixWorld);
    _lookAtPosition.set(0, 0, -1).applyMatrix4(_rotationMatrix).add(_cameraWorldPosition);
    _target.subVectors(_reflectorWorldPosition, _lookAtPosition).reflect(_normal).negate().add(_reflectorWorldPosition);
    const vc = this.virtualCamera;
    vc.position.copy(_view);
    vc.up.set(0, 1, 0).applyMatrix4(_rotationMatrix).reflect(_normal);
    vc.lookAt(_target);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // plano de recorte oblicuo: no se refleja lo que está debajo del piso
    _plane.setFromNormalAndCoplanarPoint(_normal, _reflectorWorldPosition).applyMatrix4(vc.matrixWorldInverse);
    _clipPlane.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix;
    _q.x = (Math.sign(_clipPlane.x) + pm.elements[8]) / pm.elements[0];
    _q.y = (Math.sign(_clipPlane.y) + pm.elements[9]) / pm.elements[5];
    _q.z = -1; _q.w = (1 + pm.elements[10]) / pm.elements[14];
    _clipPlane.multiplyScalar(2 / _clipPlane.dot(_q));
    pm.elements[2] = _clipPlane.x; pm.elements[6] = _clipPlane.y; pm.elements[10] = _clipPlane.z + 1 - 0.003; pm.elements[14] = _clipPlane.w;
    // render
    this.visible = false;
    const currentRT = renderer.getRenderTarget(), xr = renderer.xr.enabled, sa = renderer.shadowMap.autoUpdate, viewport = camera.viewport;
    renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vc);
    renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sa;
    renderer.setRenderTarget(currentRT);
    if (viewport !== undefined) renderer.state.viewport(viewport);
    this.visible = true;
  }

  dispose() { this.renderTarget.dispose(); this.geometry.dispose(); this.material.dispose(); }
}
