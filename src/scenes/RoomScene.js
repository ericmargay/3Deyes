import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BaseScene } from './BaseScene.js';

/**
 * Habitación isométrica (dos paredes + piso) con objetos que caen por física.
 * Colores pastel, sombras suaves. Pensada para probar profundidad estéreo:
 * el rincón de la habitación "entra" en el mural y los objetos que caen "salen".
 */
const PALETTE = [0xff4f8b, 0xffa14f, 0x4fd1c5, 0xb388ff, 0xffd166, 0xff7b5c, 0x8ecae6];

export class RoomScene extends BaseScene {
  static id = 'room';
  constructor(app) {
    super(app, 'room', 'Habitación');
    this.bodies = [];
    this.spawnAcc = 0;
    this.orbit = 0;
  }

  defineParams() {
    this.p('orbit', { min: -180, max: 180, default: 35, step: 0.1, label: 'ángulo cámara' });
    this.p('elevation', { min: 5, max: 80, default: 28, step: 0.1, label: 'elevación cámara' });
    this.p('distance', { min: 6, max: 40, default: 18, step: 0.01, label: 'distancia cámara' });
    this.p('fov', { min: 15, max: 90, default: 35, step: 0.1, label: 'fov' });
    this.p('autoRotate', { min: -30, max: 30, default: 0, step: 0.1, label: 'auto-rotar (°/s)' });
    this.p('gravity', { min: -30, max: 10, default: -9.8, step: 0.01, label: 'gravedad' });
    this.p('spawnRate', { min: 0, max: 30, default: 3, step: 0.1, label: 'objetos / s' });
    this.p('maxBodies', { min: 10, max: 400, default: 120, step: 1, label: 'máx. objetos' });
    this.p('size', { min: 0.2, max: 2, default: 0.6, step: 0.01, label: 'tamaño objetos' });
    this.p('bounce', { min: 0, max: 1, default: 0.4, step: 0.01, label: 'rebote' });
    this.p('wind', { min: -20, max: 20, default: 0, step: 0.1, label: 'viento' });
    this.p('explode', { type: 'trigger', label: '¡explotar!' });
    this.p('clear', { type: 'trigger', label: 'limpiar objetos' });
    this.p('hue', { min: 0, max: 1, default: 0, step: 0.001, label: 'giro de color' });
    this.p('wallHue', { min: 0, max: 1, default: 0, step: 0.001, label: 'color paredes' });
    this.p('wireframe', { default: false, label: 'wireframe' });
    this.p('lightAngle', { min: 0, max: 360, default: 60, step: 0.1, label: 'ángulo luz' });
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x1a1035);
    s.fog = new THREE.Fog(0x1a1035, 25, 60);

    // luces
    s.add(new THREE.HemisphereLight(0xfff0f8, 0x6a4a9a, 1.6));
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // habitación
    const W = 10, H = 8, T = 0.6;
    this.wallMats = [
      new THREE.MeshStandardMaterial({ color: 0xff6fa5, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xcdbdf5, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xf2cdb0, roughness: 0.95 }),
    ];
    this.wallBase = this.wallMats.map((m) => m.color.clone());
    const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true; s.add(m); return m; };
    mk(new THREE.BoxGeometry(W, T, W), this.wallMats[2], 0, -T / 2, 0);                 // piso
    mk(new THREE.BoxGeometry(W, H, T), this.wallMats[0], 0, H / 2, -W / 2 - T / 2);      // pared fondo
    mk(new THREE.BoxGeometry(T, H, W + T), this.wallMats[1], -W / 2 - T / 2, H / 2, -T / 2); // pared izquierda
    // estante
    mk(new THREE.BoxGeometry(0.3, 0.15, 4), new THREE.MeshStandardMaterial({ color: 0xf7d6e0 }), -W / 2 + 0.15, 4.5, -2);
    // tablero decorativo en el piso (alfombra)
    const rug = mk(new THREE.BoxGeometry(5, 0.05, 4), new THREE.MeshStandardMaterial({ color: 0x2bb5b8, roughness: 1 }), 1, 0.025, 1);
    rug.castShadow = false;

    // objetos estáticos decorativos flotando (como las figuras del estante)
    const deco = new THREE.Group(); s.add(deco); this.deco = deco;
    const decoGeos = [new THREE.TorusKnotGeometry(0.5, 0.16, 120, 16), new THREE.IcosahedronGeometry(0.7, 0), new THREE.TorusGeometry(0.6, 0.2, 16, 48), new THREE.OctahedronGeometry(0.7)];
    decoGeos.forEach((g, i) => {
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: PALETTE[i % PALETTE.length], roughness: 0.5, metalness: 0.1 }));
      m.position.set(-3.5 + i * 2.3, 5.5, -3.5 + (i % 2) * 1.5);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.spin = 0.4 + i * 0.3;
      deco.add(m);
    });

    // física
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.8, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.physMat = new CANNON.Material('obj');
    const floorMat = new CANNON.Material('floor');
    this.contact = new CANNON.ContactMaterial(this.physMat, floorMat, { friction: 0.4, restitution: 0.4 });
    this.contactObj = new CANNON.ContactMaterial(this.physMat, this.physMat, { friction: 0.3, restitution: 0.4 });
    this.world.addContactMaterial(this.contact); this.world.addContactMaterial(this.contactObj);
    const addStatic = (shape, pos) => { const b = new CANNON.Body({ mass: 0, material: floorMat, shape }); b.position.set(...pos); this.world.addBody(b); };
    addStatic(new CANNON.Box(new CANNON.Vec3(W / 2, T / 2, W / 2)), [0, -T / 2, 0]);
    addStatic(new CANNON.Box(new CANNON.Vec3(W / 2, H, T / 2)), [0, H / 2, -W / 2 - T / 2]);
    addStatic(new CANNON.Box(new CANNON.Vec3(T / 2, H, W / 2 + T)), [-W / 2 - T / 2, H / 2, 0]);
    // paredes invisibles al frente y derecha para que no se caigan al vacío
    addStatic(new CANNON.Box(new CANNON.Vec3(W / 2, H, T / 2)), [0, H / 2, W / 2 + T / 2]);
    addStatic(new CANNON.Box(new CANNON.Vec3(T / 2, H, W / 2 + T)), [W / 2 + T / 2, H / 2, 0]);

    // geometrías reutilizables para los objetos dinámicos
    this.shapes = [
      { geo: new THREE.BoxGeometry(1, 1, 1), make: (r) => new CANNON.Box(new CANNON.Vec3(r / 2, r / 2, r / 2)) },
      { geo: new THREE.SphereGeometry(0.5, 24, 16), make: (r) => new CANNON.Sphere(r / 2) },
      { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 24), make: (r) => new CANNON.Cylinder(r / 2, r / 2, r, 12) },
      { geo: new THREE.IcosahedronGeometry(0.55, 1), make: (r) => new CANNON.Sphere(r / 2) },
    ];
    this.materials = PALETTE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 }));
    this.materialBase = this.materials.map((m) => m.color.clone());
    this.dyn = new THREE.Group(); s.add(this.dyn);

    for (let i = 0; i < 25; i++) this.spawn(2 + Math.random() * 10);

    this.params.onChange((id) => {
      if (id === 'room.explode') this.explode();
      if (id === 'room.clear') this.clearBodies();
    });
  }

  spawn(y = 12 + Math.random() * 4) {
    const size = this.v('size') * (0.6 + Math.random() * 0.8);
    const sh = this.shapes[Math.floor(Math.random() * this.shapes.length)];
    const mesh = new THREE.Mesh(sh.geo, this.materials[Math.floor(Math.random() * this.materials.length)]);
    mesh.scale.setScalar(size);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const body = new CANNON.Body({ mass: size * size * size, material: this.physMat, shape: sh.make(size), sleepSpeedLimit: 0.2 });
    body.position.set((Math.random() - 0.5) * 6, y, (Math.random() - 0.5) * 6);
    body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    body.angularVelocity.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
    this.world.addBody(body);
    this.dyn.add(mesh);
    this.bodies.push({ mesh, body });
  }

  removeBody(i) {
    const { mesh, body } = this.bodies[i];
    this.world.removeBody(body); this.dyn.remove(mesh);
    this.bodies.splice(i, 1);
  }

  clearBodies() { while (this.bodies.length) this.removeBody(0); }

  explode() {
    for (const { body } of this.bodies) {
      body.wakeUp();
      const dir = new CANNON.Vec3(body.position.x, body.position.y + 1, body.position.z); dir.normalize();
      body.applyImpulse(dir.scale(8 + Math.random() * 10 * body.mass), body.position);
    }
  }

  update(dt, t) {
    const v = (n) => this.v(n);
    // cámara orbitando el rincón
    this.orbit += v('autoRotate') * dt;
    const az = THREE.MathUtils.degToRad(v('orbit') + this.orbit);
    const el = THREE.MathUtils.degToRad(v('elevation'));
    const d = v('distance');
    const target = new THREE.Vector3(0, 3, 0);
    this.camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d + 3, Math.cos(az) * Math.cos(el) * d);
    this.camera.lookAt(target);
    this.camera.fov = v('fov');

    // luz
    const la = THREE.MathUtils.degToRad(v('lightAngle'));
    this.sun.position.set(Math.sin(la) * 15, 18, Math.cos(la) * 15);

    // colores
    const hue = v('hue'), whue = v('wallHue');
    this.materials.forEach((m, i) => { m.color.copy(this.materialBase[i]).offsetHSL(hue, 0, 0); m.wireframe = v('wireframe'); });
    this.wallMats.forEach((m, i) => m.color.copy(this.wallBase[i]).offsetHSL(whue, 0, 0));

    // deco girando
    this.deco.children.forEach((m, i) => { m.rotation.y += dt * m.userData.spin; m.position.y = 5.5 + Math.sin(t * 1.2 + i) * 0.2; });

    // física
    this.world.gravity.set(v('wind'), v('gravity'), 0);
    this.contact.restitution = this.contactObj.restitution = v('bounce');
    this.spawnAcc += v('spawnRate') * dt;
    while (this.spawnAcc >= 1) { this.spawnAcc -= 1; if (this.bodies.length < v('maxBodies')) this.spawn(); }
    while (this.bodies.length > v('maxBodies')) this.removeBody(0);
    this.world.step(1 / 60, dt, 4);
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const { mesh, body } = this.bodies[i];
      if (body.position.y < -20) { this.removeBody(i); continue; }
      mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion);
    }
  }
}
