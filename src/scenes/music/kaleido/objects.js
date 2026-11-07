import * as THREE from 'three';

/**
 * Catálogo de objetos del caleidoscopio: lo que hay en la cámara de un
 * caleidoscopio de verdad (gemas talladas, cristales, esquirlas de vidrio,
 * pétalos, estrellas y flores de lentejuela, cuentas, perlas, tubos,
 * anillos, purpurina, agujas).
 *
 * Todas las formas son simétricas en x local: así una copia espejada se dibuja
 * reflejando x en el vértice y no da vuelta las caras. Todas sin índices y con
 * coordenadas baricéntricas (para las aristas del estilo neón).
 *
 * Cada tipo trae su material: vidrio (cuánta luz deja pasar), metal,
 * rugosidad, iridiscencia (película fina), aristas y facetado.
 */
function finish(g, { flat = false, rotX = 0 } = {}) {
  if (rotX) g.rotateX(rotX);
  g.computeBoundingSphere();
  const s = 1 / g.boundingSphere.radius; g.scale(s, s, s);
  let ng = g.index ? g.toNonIndexed() : g;
  if (flat) { ng.deleteAttribute('normal'); ng.computeVertexNormals(); }   // sin índices: normales por cara (facetas)
  else if (!ng.attributes.normal) ng.computeVertexNormals();
  const n = ng.attributes.position.count, b = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) b[i * 3 + (i % 3)] = 1;
  ng.setAttribute('bary', new THREE.BufferAttribute(b, 3));
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'bary'].includes(k)) ng.deleteAttribute(k);
  return ng;
}

function shapeFrom(pts) { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; }
function extrude(shape, depth = 0.18, bevel = 0.06) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}
// polígono en estrella (punta hacia arriba): simétrico en x
function starPts(k, ro, ri) { const out = []; for (let i = 0; i < k * 2; i++) { const a = Math.PI / 2 + (i * Math.PI) / k, r = i % 2 ? ri : ro; out.push([Math.cos(a) * r, Math.sin(a) * r]); } return out; }
// flor de pétalos redondeados: r(θ) medido desde +y, simétrico en x
function flowerPts(k, samples = 42) { const out = []; for (let i = 0; i < samples; i++) { const th = (i / samples) * Math.PI * 2, r = 0.42 + 0.58 * Math.pow(Math.abs(Math.cos((k / 2) * th)), 0.8); out.push([Math.sin(th) * r, Math.cos(th) * r]); } return out; }

/** Tipos: geometría + material (vidrio, metal, rugosidad, iridiscencia, aristas). */
export function makeKinds() {
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const teardrop = new THREE.Shape(); teardrop.moveTo(0, 1); teardrop.quadraticCurveTo(0.7, 0.05, 0, -0.85); teardrop.quadraticCurveTo(-0.7, 0.05, 0, 1);
  return {
    gema:       { geo: finish(lathe([[0.001, -0.95], [1, 0], [0.92, 0.1], [0.58, 0.42], [0.001, 0.42]], 8), { flat: true, rotX: Math.PI / 2 }), glass: 0.9, metal: 0, rough: 0.03, irid: 0.35, edge: 0.6 },
    cristal:    { geo: finish(lathe([[0.001, -1.15], [0.34, -0.62], [0.34, 0.62], [0.001, 1.15]], 6), { flat: true }), glass: 0.92, metal: 0, rough: 0.02, irid: 0.6, edge: 1 },
    esquirla:   { geo: finish(extrude(shapeFrom([[0, 1], [0.42, 0.12], [0, -0.78], [-0.42, 0.12]]), 0.1, 0.05), { flat: true }), glass: 0.85, metal: 0, rough: 0.05, irid: 0.25, edge: 1 },
    petalo:     { geo: finish(extrude(teardrop, 0.12, 0.08)), glass: 0.7, metal: 0, rough: 0.12, irid: 0.2, edge: 0.5 },
    estrella:   { geo: finish(extrude(shapeFrom(starPts(5, 1, 0.42)), 0.12, 0.05), { flat: true }), glass: 0.1, metal: 0.75, rough: 0.16, irid: 0.85, edge: 1 },
    flor:       { geo: finish(extrude(shapeFrom(flowerPts(6)), 0.1, 0.06)), glass: 0.55, metal: 0.25, rough: 0.08, irid: 0.6, edge: 0.25 },
    cuenta:     { geo: finish(new THREE.IcosahedronGeometry(1, 1), { flat: true }), glass: 0.75, metal: 0, rough: 0.04, irid: 0.3, edge: 0.7 },
    perla:      { geo: finish(new THREE.SphereGeometry(1, 12, 9)), glass: 0, metal: 0, rough: 0.28, irid: 1, edge: 0 },
    tubo:       { geo: finish(new THREE.CylinderGeometry(0.3, 0.3, 1.1, 14, 1)), glass: 0.75, metal: 0, rough: 0.07, irid: 0.25, edge: 0.3 },
    anillo:     { geo: finish(new THREE.TorusGeometry(1, 0.08, 6, 32)), glass: 0, metal: 1, rough: 0.14, irid: 0.15, edge: 0.2 },
    lentejuela: { geo: finish(new THREE.CylinderGeometry(1, 1, 0.07, 28, 1), { rotX: Math.PI / 2 }), glass: 0, metal: 0.9, rough: 0.05, irid: 1, edge: 0.4 },
    brillo:     { geo: finish(new THREE.OctahedronGeometry(1).scale(1, 1, 0.18), { flat: true }), glass: 0, metal: 1, rough: 0.02, irid: 1, edge: 1 },
    aguja:      { geo: finish(new THREE.CylinderGeometry(0.009, 0.009, 2, 6, 1)), glass: 0, metal: 1, rough: 0.12, irid: 0.1, edge: 0 },
  };
}
