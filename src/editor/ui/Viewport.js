import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

/**
 * Viewport del editor: cámara orbital propia, gizmo de transformación,
 * grilla y caja de selección. Los helpers viven en una escena aparte que se
 * dibuja encima de la escena editada.
 */
export class Viewport {
  constructor(container, renderer, { onSelect, onTransform, onTransformEnd }) {
    this.container = container;
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
    this.camera.position.set(12, 9, 16);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.helpers = new THREE.Scene();
    this.grid = new THREE.GridHelper(200, 200, 0x3a3a4a, 0x22222c);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.45; this.grid.material.depthWrite = false;
    this.grid.userData.helper = true;
    this.helpers.add(this.grid);
    const axis = (dir, color) => { const g = new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-100), dir.clone().multiplyScalar(100)]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })); this.helpers.add(l); };
    axis(new THREE.Vector3(1, 0, 0), 0xff4f6d); axis(new THREE.Vector3(0, 0, 1), 0x4f8dff);
    // ejes de orientación en la esquina
    this.axesScene = new THREE.Scene();
    this.axes = new THREE.AxesHelper(1);
    this.axes.setColors(new THREE.Color(0xff4f6d), new THREE.Color(0x3ddc84), new THREE.Color(0x4f8dff));
    this.axesScene.add(this.axes);
    this.axesCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    this.axesCam.position.set(0, 0, 3);
    this.gizmo = new TransformControls(this.camera, renderer.domElement);
    this.gizmo.setSize(0.8);
    this.helpers.add(this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);
    this.gizmo.addEventListener('dragging-changed', (e) => { this.controls.enabled = !e.value; if (!e.value && this.selected) onTransformEnd?.(this.selected); });
    this.gizmo.addEventListener('objectChange', () => { if (this.selected) onTransform?.(this.selected); });
    this.box = new THREE.BoxHelper(new THREE.Object3D(), 0xff4fa3);
    this.box.visible = false; this.helpers.add(this.box);
    this.selected = null;
    this.root = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.15; this.raycaster.params.Points.threshold = 0.15;
    this.enabled = true;
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this.enabled || !down || this.gizmo.dragging) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      onSelect?.(this.pick(e));
    });
  }

  setRoot(root) { this.root = root; this.select(null); }

  pick(e) {
    if (!this.root) return null;
    const r = this.container.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hits = this.raycaster.intersectObjects(this.root.children, true).filter((h) => h.object.visible && !h.object.userData.helper);
    if (!hits.length) return null;
    // preferir mallas sobre líneas/puntos cuando están cerca
    const mesh = hits.find((h) => h.object.isMesh && h.distance < hits[0].distance + 0.5);
    return (mesh || hits[0]).object;
  }

  select(obj) {
    this.selected = obj;
    if (obj) { this.gizmo.attach(obj); this.box.setFromObject(obj); this.box.visible = true; }
    else { this.gizmo.detach(); this.box.visible = false; }
  }

  setMode(m) { this.gizmo.setMode(m); }

  frame(obj) {
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) { this.controls.target.copy(obj.getWorldPosition(new THREE.Vector3())); return; }
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    const dir = new THREE.Vector3().subVectors(this.camera.position, c).normalize();
    this.camera.position.copy(c).addScaledVector(dir, Math.max(1.5, s * 1.4));
    this.controls.update();
  }

  /** Coloca la cámara del editor donde está la cámara de la escena (para arrancar desde su punto de vista). */
  matchCamera(cam) {
    this.camera.position.copy(cam.getWorldPosition(new THREE.Vector3()));
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.controls.target.copy(this.camera.position).addScaledVector(dir, 10);
    this.controls.update();
  }

  setSize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.w = w; this.h = h; }

  /** Caja de la escena ignorando helpers y objetos gigantes (túnel oclusor, quads de pantalla completa). */
  sceneBox(root) {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    root.traverse((o) => {
      if (!o.visible || o.userData.helper || !(o.isMesh || o.isLine || o.isPoints) || !o.geometry) return;
      if (o.isPoints && o.geometry.boundingSphere?.radius > 500) return;
      tmp.setFromObject(o);
      if (tmp.isEmpty() || tmp.getSize(new THREE.Vector3()).length() > 400) return;
      box.union(tmp);
    });
    return box;
  }

  /** Encuadra toda la escena desde un ángulo isométrico. */
  frameAll(root) {
    const box = this.sceneBox(root);
    if (box.isEmpty()) { this.camera.position.set(12, 9, 16); this.controls.target.set(0, 0, 0); this.controls.update(); return; }
    const c = box.getCenter(new THREE.Vector3()), s = Math.max(2, box.getSize(new THREE.Vector3()).length());
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(0.62, 0.45, 0.64).multiplyScalar(s * 0.9));
    this.camera.near = Math.max(0.01, s * 0.001); this.camera.far = Math.max(2000, s * 20); this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  update() {
    this.controls.update();
    if (this.selected) this.box.setFromObject(this.selected);
  }

  renderHelpers(visible) {
    if (!visible) return;
    const r = this.renderer;
    const prev = r.autoClear; r.autoClear = false;
    r.render(this.helpers, this.camera);
    // ejes de orientación abajo a la derecha
    const size = 90, pr = r.getPixelRatio(), W = this.w || 100;
    this.axes.quaternion.copy(this.camera.quaternion).invert();
    r.setViewport(W * pr - size * pr - 10, 10, size * pr, size * pr); r.setScissor(W * pr - size * pr - 10, 10, size * pr, size * pr); r.setScissorTest(true);
    r.render(this.axesScene, this.axesCam);
    r.setScissorTest(false); r.setViewport(0, 0, W * pr, (this.h || 100) * pr);
    r.autoClear = prev;
  }
}
