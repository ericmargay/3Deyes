import * as THREE from 'three';

/**
 * Patrón de calibración en 3D. Se renderiza a través del StereoOutput, así que
 * la disparidad de las figuras es la real:
 *  - barra roja en el plano de convergencia (paralaje 0) = 50 % del ancho de la imagen
 *  - anillo blanco en el plano de convergencia
 *  - cuadrado amarillo a la distancia del "objeto más cercano" (paralaje cruzado)
 *  - rombo cian muy lejos (paralaje no cruzado)
 * Los tamaños se recalculan cada frame según focus / fov / zNear.
 */
export class PatternScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
    this.camera.position.set(0, 0, 0);
    this.handlesDepthLook = true;
    const red = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), red); this.scene.add(this.bar);
    this.ticks = new THREE.Group(); this.scene.add(this.ticks);
    for (let i = 0; i <= 10; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), red); m.userData.i = i; this.ticks.add(m); }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })); this.scene.add(this.ring);
    this.near = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffd166 })); this.scene.add(this.near);
    this.far = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x4fd1c5 })); this.scene.add(this.far);
    this.far.rotation.z = Math.PI / 4;
    this.center = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0xffffff })); this.scene.add(this.center);
    this.border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x666666 })); this.scene.add(this.border);
  }

  /** @param o { focus, fov, zNear, aspect } */
  update(o) {
    const f = o.focus, aspect = o.aspect || this.camera.aspect;
    const Hf = 2 * f * Math.tan((o.fov * Math.PI) / 360), Wf = Hf * aspect; // visible en el plano de convergencia
    const z = -f;
    this.bar.scale.set(Wf * 0.5, Hf * 0.012, 1); this.bar.position.set(0, -Hf * 0.4, z);
    this.ticks.children.forEach((m) => { const i = m.userData.i; m.scale.set(Wf * 0.004, Hf * (i % 5 === 0 ? 0.07 : 0.04), 1); m.position.set(-Wf * 0.25 + (Wf * 0.5 * i) / 10, -Hf * 0.4, z); });
    const s = Hf * 0.12;
    this.ring.scale.set(s, s, 1); this.ring.position.set(0, Hf * 0.05, z);
    this.center.scale.set(Hf * 0.01, Hf * 0.01, 1); this.center.position.set(0, 0, z + 0.001);
    this.border.scale.set(Wf * 0.98, Hf * 0.98, 1); this.border.position.set(0, 0, z);
    // objeto cercano: mismo tamaño angular que el anillo, a zNear
    const zn = Math.max(0.05, o.zNear), k = zn / f;
    this.near.scale.set(s * 0.7 * k, s * 0.7 * k, 1); this.near.position.set(0, Hf * 0.05 * k, -zn);
    const zf = f * 40, kf = zf / f;
    this.far.scale.set(s * 0.6 * kf, s * 0.6 * kf, 1); this.far.position.set(Wf * 0.28 * kf, Hf * 0.05 * kf, -zf);
  }
}
