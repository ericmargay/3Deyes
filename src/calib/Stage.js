import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Wall } from './Wall.js';
import { Person } from './Person.js';
import { fmtM } from '../core/StereoMath.js';

/**
 * Escenario: nave oscura con piso reflectante, el mural a escala, el público
 * a la distancia elegida, zonas de confort en el piso y la geometría de
 * vergencia (líneas ojo → imagen, punto de convergencia, objetos virtuales).
 * 1 unidad = 1 metro. El mural está en z = 0 mirando a +z; el público en +z.
 */
export class Stage {
  constructor(wallTexture) {
    RectAreaLightUniformsLib.init();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060a);
    this.scene.fog = new THREE.FogExp2(0x04060a, 0.012);

    this.hall = this.buildHall();
    this.scene.add(this.hall);

    this.wall = new Wall(wallTexture);
    this.scene.add(this.wall.group);

    this.wallLight = new THREE.RectAreaLight(0xffffff, 6, 8, 4.5);
    this.wallLight.position.set(0, 3, 0.05);
    this.wallLight.lookAt(0, 3, 10);
    this.scene.add(this.wallLight);

    this.hemi = new THREE.HemisphereLight(0x4a5868, 0x0a0d12, 0.7);
    this.scene.add(this.hemi);
    this.fill = new THREE.PointLight(0x8899aa, 40, 60, 1.6);
    this.fill.position.set(-14, 11, 25);
    this.scene.add(this.fill);
    this.fill2 = this.fill.clone(); this.fill2.position.set(14, 11, 45); this.scene.add(this.fill2);

    this.person = new Person(); this.scene.add(this.person.group);
    this.ghostMin = new Person(0xff4f6d, 0.35); this.scene.add(this.ghostMin.group);
    this.ghostOk = new Person(0x3ddc84, 0.35); this.scene.add(this.ghostOk.group);

    this.zones = new THREE.Group(); this.scene.add(this.zones);
    this.markers = new THREE.Group(); this.scene.add(this.markers);
    this.geometry = new THREE.Group(); this.scene.add(this.geometry);
    this.labels = [];
    this.lineMats = { L: new THREE.LineBasicMaterial({ color: 0xff4fa3 }), R: new THREE.LineBasicMaterial({ color: 0x4fd1c5 }), dim: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }) };
  }

  buildHall() {
    const g = new THREE.Group();
    const W = 44, H = 16, D = 90;
    const mat = new THREE.MeshStandardMaterial({ color: 0x262c34, roughness: 0.9, metalness: 0.1 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x343c46, roughness: 0.75, metalness: 0.25 });
    const mk = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.receiveShadow = true; g.add(o); return o; };
    mk(new THREE.PlaneGeometry(W, H), mat, 0, H / 2, -0.3);                  // pared del mural
    mk(new THREE.PlaneGeometry(D, H), mat, -W / 2, H / 2, D / 2 - 5, Math.PI / 2);
    mk(new THREE.PlaneGeometry(D, H), mat, W / 2, H / 2, D / 2 - 5, -Math.PI / 2);
    const ceil = mk(new THREE.PlaneGeometry(W, D), mat, 0, H, D / 2 - 5); ceil.rotation.x = Math.PI / 2;
    // vigas y paneles
    for (let z = 2; z < D - 6; z += 6) {
      mk(new THREE.BoxGeometry(W, 0.35, 0.5), beamMat, 0, H - 0.2, z);
      mk(new THREE.BoxGeometry(0.4, H, 0.5), beamMat, -W / 2 + 0.2, H / 2, z);
      mk(new THREE.BoxGeometry(0.4, H, 0.5), beamMat, W / 2 - 0.2, H / 2, z);
    }
    for (let y = 3; y < H; y += 4) {
      mk(new THREE.BoxGeometry(0.15, 0.12, D), beamMat, -W / 2 + 0.1, y, D / 2 - 5);
      mk(new THREE.BoxGeometry(0.15, 0.12, D), beamMat, W / 2 - 0.1, y, D / 2 - 5);
      mk(new THREE.BoxGeometry(W, 0.12, 0.15), beamMat, 0, y, -0.2);
    }
    // piso reflectante + capa oscura "mojada"
    this.reflector = new Reflector(new THREE.PlaneGeometry(W, D), { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0x777777 });
    this.reflector.rotation.x = -Math.PI / 2; this.reflector.position.set(0, 0, D / 2 - 5); g.add(this.reflector);
    this.floorOverlay = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.72 }));
    this.floorOverlay.rotation.x = -Math.PI / 2; this.floorOverlay.position.set(0, 0.004, D / 2 - 5); this.floorOverlay.receiveShadow = true; g.add(this.floorOverlay);
    return g;
  }

  label(text, pos, cls = '') {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls; el.textContent = text;
    const o = new CSS2DObject(el); o.position.copy(pos);
    this.geometry.add(o); this.labels.push(o);
    return o;
  }

  clearGroup(g) {
    while (g.children.length) { const c = g.children.pop(); c.geometry?.dispose?.(); c.material?.dispose?.(); if (c.element) c.element.remove(); }
  }

  line(a, b, mat) { this.geometry.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat)); }
  dot(p, color, r = 0.12) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color })); m.position.copy(p); this.geometry.add(m); return m; }

  /**
   * Actualiza todo con el análisis `a` (StereoMath.analyze) y los parámetros `o`:
   * o.screenW, o.pxW, o.pxH, o.bottom, o.ipd, o.mode, o.eyeSep, o.focus,
   * o.zNear, o.viewerD, o.eyeH, o.personH, s = ajustes de escenario.
   */
  update(a, o, s) {
    const H = a.screenH;
    this.wall.setSize(o.screenW, H, o.bottom, o.pxW, o.pxH);
    this.wallLight.width = o.screenW; this.wallLight.height = H;
    this.wallLight.position.set(0, o.bottom + H / 2, 0.05);
    this.wallLight.intensity = s.wallLight;
    this.wallLight.lookAt(0, o.bottom + H / 2, 10);
    this.fill.intensity = this.fill2.intensity = s.hallLight;
    this.scene.fog.density = s.fog;
    this.floorOverlay.material.opacity = 1 - s.reflection;
    this.hall.visible = true;

    // público
    const D = o.viewerD;
    this.person.setHeight(o.personH); this.person.setPosition(0, D); this.person.setVisible(s.person);
    this.ghostMin.setHeight(o.personH); this.ghostMin.setPosition(-1.2, a.rec.dMin); this.ghostMin.setVisible(s.ghosts && !s.pov && a.rec.ok && a.rec.dMin > 0.5);
    this.ghostOk.setHeight(o.personH); this.ghostOk.setPosition(1.2, a.rec.dComfort); this.ghostOk.setVisible(s.ghosts && !s.pov && a.rec.ok && a.rec.dComfort > 0.5);
    this.geometry.visible = !s.pov;
    this.markers.visible = !s.pov;

    // zonas en el piso
    this.clearGroup(this.zones);
    if (s.zones) {
      const zone = (z0, z1, color) => {
        if (z1 <= z0) return;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(8, z1 - z0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set(0, 0.01, (z0 + z1) / 2); this.zones.add(m);
      };
      if (a.rec.ok) { zone(0, a.rec.dMin, 0xff3355); zone(a.rec.dMin, a.rec.dComfort, 0xffd166); zone(a.rec.dComfort, Math.max(a.rec.dComfort, D) + 25, 0x3ddc84); }
      else zone(0, Math.max(D, 10) + 25, 0xff3355);
    }

    // marcas de distancia en el piso
    this.clearGroup(this.markers);
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x8892a0 });
    const maxZ = Math.ceil(Math.max(D, a.rec.dComfort) + 10);
    for (let z = 1; z <= maxZ; z++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(z % 5 === 0 ? 0.6 : 0.3, 0.01, 0.04), tickMat);
      t.position.set(0, 0.015, z); this.markers.add(t);
    }
    const axis = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, maxZ), tickMat); axis.position.set(0, 0.012, maxZ / 2); this.markers.add(axis);

    // geometría de vergencia
    this.clearGroup(this.geometry); this.labels = [];
    const cy = o.bottom + H / 2, eyeY = o.eyeH;
    const eyeL = new THREE.Vector3(-o.ipd / 2, eyeY, D), eyeR = new THREE.Vector3(o.ipd / 2, eyeY, D);
    this.dot(eyeL, 0xff4fa3, 0.05); this.dot(eyeR, 0x4fd1c5, 0.05);
    for (let z = 5; z <= maxZ; z += 5) this.label(`${z} m`, new THREE.Vector3(0.6, 0.02, z), 'small');
    this.label(`mural ${fmtM(o.screenW)} × ${fmtM(H)}`, new THREE.Vector3(0, o.bottom + H + 0.4, 0));

    if (!s.vergence) return;
    const two = o.mode === 'parallel' || o.mode === 'cross';
    // centro de la imagen que mira cada ojo
    const cLx = two ? -a.sepX / 2 : 0, cRx = two ? a.sepX / 2 : 0;
    const lookL = o.mode === 'cross' ? cRx : cLx, lookR = o.mode === 'cross' ? cLx : cRx;
    const wL = new THREE.Vector3(lookL, cy, 0), wR = new THREE.Vector3(lookR, cy, 0);
    this.line(eyeL, wL, this.lineMats.L); this.line(eyeR, wR, this.lineMats.R);
    if (two) { this.dot(wL, 0xff4fa3, 0.08); this.dot(wR, 0x4fd1c5, 0.08); }

    const conv = intersect(eyeL, wL, eyeR, wR);
    if (o.mode === 'cross' && conv) {
      this.dot(conv.p, 0xffffff, 0.08);
      this.label(`convergen a ${fmtM(conv.p.distanceTo(new THREE.Vector3(0, eyeY, D)))} del público · ${conv.deg.toFixed(1)}°`, conv.p.clone().add(new THREE.Vector3(0, 0.45, 0)));
    } else if (o.mode === 'parallel') {
      this.label(a.parallel.viable ? `paralela: separación ${fmtM(a.sepX)} ≤ IPD` : `paralela: los ojos deberían divergir ${(2 * Math.atan((a.sepX - o.ipd) / (2 * D)) / Math.PI * 180).toFixed(1)}°`, new THREE.Vector3(0, cy + 1, D / 2), a.parallel.viable ? 'ok' : 'bad');
    }

    // objeto virtual más cercano y fondo (a partir del paralaje real de la escena)
    const toM = a.imageW / a.Wf;
    const offNear = (o.eyeSep / 2) * (1 - o.focus / Math.max(0.01, o.zNear)) * toM;  // negativo = cruzado
    const offFar = (o.eyeSep / 2) * toM;
    let stack = 0;
    const showVirtual = (off, color, name) => {
      stack += 1;
      const pL = new THREE.Vector3(lookL - off, cy + 0.6, 0), pR = new THREE.Vector3(lookR + off, cy + 0.6, 0);
      this.line(eyeL, pL, this.lineMats.dim); this.line(eyeR, pR, this.lineMats.dim);
      const hit = intersect(eyeL, pL, eyeR, pR);
      if (hit && hit.t > 0 && hit.t < 40) {
        this.dot(hit.p, color, 0.1);
        const dist = hit.p.distanceTo(new THREE.Vector3(0, eyeY, D));
        const inFront = hit.p.z > 0;
        this.label(`${name}: ${inFront ? 'delante' : 'detrás'} del mural, a ${fmtM(dist)} del público · Δ ${(hit.deg - (conv?.deg ?? 0)).toFixed(2)}°`, hit.p.clone().add(new THREE.Vector3(0, 0.45 + 0.35 * stack, 0)), 'small');
        // extender las líneas detrás del mural
        if (!inFront) { this.line(pL, hit.p, this.lineMats.dim); this.line(pR, hit.p, this.lineMats.dim); }
      } else {
        this.label(`${name}: los ojos divergen (paralaje ${fmtM(Math.abs(off * 2))} > IPD)`, new THREE.Vector3(0, cy + 1.2 + 0.4 * stack, 0), 'bad');
      }
    };
    if (o.mode !== 'mono') { showVirtual(offNear, 0xffd166, 'objeto cercano'); showVirtual(offFar, 0x4fd1c5, 'fondo'); }
  }

  /** Cámara para la vista "desde el público". */
  viewerPose(o) {
    return { pos: new THREE.Vector3(0, o.eyeH, o.viewerD), target: new THREE.Vector3(0, o.bottom + this.wall.mesh.scale.y / 2, 0) };
  }
}

/** Intersección de dos rectas (a1→a2) y (b1→b2) en el plano XZ; t = parámetro sobre la primera. */
function intersect(a1, a2, b1, b2) {
  const dax = a2.x - a1.x, daz = a2.z - a1.z, dbx = b2.x - b1.x, dbz = b2.z - b1.z;
  const den = dax * dbz - daz * dbx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b1.x - a1.x) * dbz - (b1.z - a1.z) * dbx) / den;
  if (t <= 0) return null;
  const p = new THREE.Vector3(a1.x + dax * t, a1.y + (a2.y - a1.y) * t, a1.z + daz * t);
  const va = new THREE.Vector3().subVectors(p, a1).normalize(), vb = new THREE.Vector3().subVectors(p, b1).normalize();
  const deg = Math.acos(Math.min(1, Math.max(-1, va.dot(vb)))) / Math.PI * 180;
  return { p, t, deg };
}
