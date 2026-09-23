import * as THREE from 'three';

/**
 * El mural: un plano subdividido a escala real (metros) que muestra la textura
 * compuesta (lo que sale del proyector) con relieve 2.5D: la altura sale del
 * canal alpha (convención CineShader) o de la luminancia. La AO se calcula
 * a partir de la altura y hay un sombreado por normal para leer el relieve.
 */
const vert = /* glsl */ `
  uniform sampler2D map;
  uniform float relief;
  uniform int reliefSource;
  varying vec2 vUv;
  float heightAt(vec2 uv) {
    vec4 c = texture2D(map, uv);
    if (reliefSource == 0) return c.a;
    if (reliefSource == 1) return dot(c.rgb, vec3(0.299, 0.587, 0.114));
    return 0.0;
  }
  void main() {
    vUv = uv;
    float h = heightAt(uv);
    vec3 p = position + normal * h * relief;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const frag = /* glsl */ `
  uniform sampler2D map;
  uniform float relief;
  uniform int reliefSource;
  uniform vec2 texel;
  uniform vec2 sizeM;      // ancho / alto del mural en metros
  uniform float brightness, aoAmount, shading;
  uniform vec3 lightDir;
  varying vec2 vUv;
  float heightAt(vec2 uv) {
    vec4 c = texture2D(map, uv);
    if (reliefSource == 0) return c.a;
    if (reliefSource == 1) return dot(c.rgb, vec3(0.299, 0.587, 0.114));
    return 0.0;
  }
  void main() {
    vec4 c = texture2D(map, vUv);
    float h = heightAt(vUv);
    float hx = heightAt(vUv + vec2(texel.x, 0.0)) - heightAt(vUv - vec2(texel.x, 0.0));
    float hy = heightAt(vUv + vec2(0.0, texel.y)) - heightAt(vUv - vec2(0.0, texel.y));
    vec3 n = normalize(vec3(-hx * relief / (2.0 * texel.x * sizeM.x), -hy * relief / (2.0 * texel.y * sizeM.y), 1.0));
    float ndl = max(0.0, dot(n, normalize(lightDir)));
    float ao = mix(1.0 - aoAmount, 1.0, h);
    if (reliefSource == 2) { ao = 1.0; ndl = 1.0; }
    vec3 col = c.rgb * brightness * ao * mix(1.0, 0.3 + 0.7 * ndl, shading);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Wall {
  constructor(texture) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture }, relief: { value: 0.3 }, reliefSource: { value: 0 },
        texel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) }, sizeM: { value: new THREE.Vector2(8, 4.5) },
        brightness: { value: 1.6 }, aoAmount: { value: 0.6 }, shading: { value: 0.6 },
        lightDir: { value: new THREE.Vector3(0.4, 0.7, 1).normalize() },
      },
      vertexShader: vert, fragmentShader: frag,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 240, 135), this.material);
    this.mesh.frustumCulled = false;
    // contorno del área proyectada
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.6 }));
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.outline);
  }

  /** Coloca el mural: ancho/alto físico y altura del borde inferior sobre el piso. */
  setSize(w, h, bottom, pxW, pxH) {
    this.mesh.scale.set(w, h, 1); this.outline.scale.set(w, h, 1);
    this.group.position.set(0, bottom + h / 2, 0.02);
    this.outline.position.z = -0.005;
    this.material.uniforms.sizeM.value.set(w, h);
    this.material.uniforms.texel.value.set(1 / pxW, 1 / pxH);
  }
}
