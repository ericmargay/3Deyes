import * as THREE from 'three';

/** Silueta humana procedural (1.75 m) para dar escala. Los ojos quedan en `eyes`. */
export class Person {
  constructor(color = 0x08090c, opacity = 1) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, transparent: opacity < 1, opacity });
    const add = (geo, x, y, z, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; this.group.add(m); return m; };
    add(new THREE.CapsuleGeometry(0.085, 0.72, 4, 12), -0.11, 0.45, 0);   // piernas
    add(new THREE.CapsuleGeometry(0.085, 0.72, 4, 12), 0.11, 0.45, 0);
    add(new THREE.CapsuleGeometry(0.19, 0.5, 4, 16), 0, 1.15, 0);        // torso
    add(new THREE.CapsuleGeometry(0.06, 0.55, 4, 10), -0.27, 1.1, 0, 0.08); // brazos
    add(new THREE.CapsuleGeometry(0.06, 0.55, 4, 10), 0.27, 1.1, 0, -0.08);
    add(new THREE.SphereGeometry(0.11, 20, 16), 0, 1.63, 0);             // cabeza
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 12), 0, 1.5, 0);    // cuello
    this.eyeHeight = 1.6;
    this.eyes = new THREE.Group();
    this.eyes.position.set(0, this.eyeHeight, -0.09);
    this.group.add(this.eyes);
    this.mat = mat;
  }

  /** Escala la figura a una altura total en metros (ojos ≈ 91 % de la altura). */
  setHeight(h) {
    const s = h / 1.75;
    this.group.scale.setScalar(s);
    this.eyeHeight = 1.6 * s;
  }

  setPosition(x, z) { this.group.position.set(x, 0, z); }
  setVisible(v) { this.group.visible = v; }
}
