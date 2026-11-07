import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { MusicScene } from './MusicScene.js';
import { LightRig, ArtNetClient } from '../../stage/rig.js';
import { WetFloor } from '../../stage/WetFloor.js';
import { Beam } from '../../stage/Beam.js';
import { makeMaterials, Sky, buildShelter, buildMuralWall, buildTruss, buildSilhouettes, loadSetGLB } from '../../stage/Set.js';

/**
 * ESCENARIO: el set del concierto, a escala real y con cámara frontal fija,
 * como una previsualización de iluminación (y, en vivo, como control del
 * rig real por Art-Net). Un predio exterior de noche: el muro del mural al
 * fondo con la proyección (otra escena renderizada adentro), dos pabellones
 * enfrentados con barras de luz bajo los techos, tubos de LEDs, cabezas
 * móviles con haces en el humo, washes, piso mojado que refleja todo y un
 * cielo que destella con los graves. Todo lo mueven los triggers de audio
 * (ataque / liberación por banda, sin keyframes).
 *
 * Referencias: el video de "Audio Trigger" (Blender) y SKALAR.
 */
const tubeVert = /* glsl */ `varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const tubeFrag = /* glsl */ `
  uniform sampler2D px; uniform float glow, pixels;
  varying vec2 vUv; varying vec3 vN, vV;
  void main() {
    vec3 c = texture2D(px, vec2(vUv.y, 0.5)).rgb;
    float seg = 0.75 + 0.25 * smoothstep(0.1, 0.3, abs(fract(vUv.y * pixels) - 0.5));   // LEDs discretos bajo el difusor
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    vec3 col = vec3(0.015) + c * glow * seg * (0.8 + 0.2 * (1.0 - f)) + c * f * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class EscenarioScene extends MusicScene {
  static id = 'escenario';
  static title = 'Escenario';
  constructor(app) { super(app, 'escenario', 'Escenario'); this.rig = null; this.envTimer = 0; this.rnd = Math.random; }

  defineParams() {
    super.defineParams();
    const keys = (Array.isArray(this.app.scenes) ? this.app.scenes : Object.values(this.app.scenes || {})).map((s) => s.key).filter((k) => k !== 'escenario');
    this.p('contenido', { type: 'option', options: keys, default: keys.includes('cintas') ? 'cintas' : keys[0], label: 'qué se proyecta en el mural' });
    this.p('camara', { type: 'option', options: ['frontal', 'público', 'lateral', 'cenital', 'director'], default: 'frontal', label: 'cámara' });
    this.p('altura', { min: 0.6, max: 6, default: 1.5, step: 0.01, label: 'altura de la cámara (m)' });
    this.p('distancia', { min: 6, max: 30, default: 15.5, step: 0.1, label: 'distancia de la cámara (m)' });
    this.p('fov', { min: 25, max: 80, default: 42, step: 0.5, label: 'fov' });
    this.p('humo', { min: 0, max: 1.5, default: 0.55, step: 0.01, label: 'humo (haces)' });
    this.p('charcos', { min: 0, max: 1, default: 0.55, step: 0.01, label: 'charcos (reflejo)' });
    this.p('cielo', { min: 0, max: 2, default: 1, step: 0.01, label: 'cielo: destello con los graves' });
    this.p('cieloBase', { min: 0, max: 1.5, default: 0.22, step: 0.01, label: 'cielo: brillo base' });
    this.p('pantallaBrillo', { min: 0, max: 3, default: 0.7, step: 0.01, label: 'brillo de la proyección' });
    this.p('siluetas', { default: true, label: 'siluetas' });
    this.p('resolucion', { type: 'option', options: ['960', '1280', '1920'], default: '1280', label: 'resolución de la proyección' });
    this.rig = new LightRig(this.params);
    this.artnet = new ArtNetClient(this.params, (m) => this.app.log?.(m));
  }

  /** Ajustes de look que conviene tener al entrar la primera vez (después quedan en manos del usuario). */
  get look() { return { 'look.bloom': 0.9, 'look.bloomThreshold': 0.8, 'look.bloomRadius': 0.5, 'look.exposure': 0.95, 'fx.vineta': 0.5, 'fx.grano': 0.12, 'fx.tinte': 0.3, 'fx.contraste': 1.28, 'fx.saturacion': 1.05 }; }
  set look(_) { /* fijo */ }

  build() {
    RectAreaLightUniformsLib.init();
    const s = this.scene, R = this.rig.def, M = this.M = makeMaterials();
    s.background = null;
    s.fog = new THREE.FogExp2(0x100406, 0.007);
    this.sky = new Sky(); s.add(this.sky);
    s.add(new THREE.AmbientLight(0x302028, 0.06));
    // piso mojado
    this.floor = new WetFloor({ size: 90, repeat: 14, puddles: this.v('charcos'), textureWidth: 1024, textureHeight: 512, reflect: 0.8, color: 0x5a5a60 });
    this.floor.receiveShadow = true; s.add(this.floor);
    // set: pabellones (o un GLB escaneado), muro del mural, truss
    this.set = new THREE.Group(); this.set.name = 'set'; s.add(this.set);
    this.set.add(buildShelter(-1, M, this.rnd), buildShelter(1, M, this.rnd));
    loadSetGLB(`${import.meta.env?.BASE_URL ?? '/'}modelos/escenario.glb`).then((g) => { if (g) { this.set.clear(); this.set.add(g); this.app.log?.('escenario: set cargado de modelos/escenario.glb'); } });
    s.add(buildMuralWall(M, R.screen.w, R.screen.h, R.screen.bottom, R.screen.z));
    s.add(buildTruss(M, 16, 7.5, 0.4));
    // pantalla del mural (render de otra escena)
    const res = parseInt(this.v('resolucion'), 10);
    this.rt = new THREE.WebGLRenderTarget(res, Math.round((res * R.screen.h) / R.screen.w), { type: THREE.HalfFloatType });
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.rt.texture, toneMapped: true });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(R.screen.w, R.screen.h), this.screenMat);
    this.screen.position.set(0, R.screen.bottom + R.screen.h / 2, R.screen.z + 0.03); this.screen.name = 'pantalla'; s.add(this.screen);
    this.screenLight = new THREE.RectAreaLight(0xffffff, 2, R.screen.w, R.screen.h); this.screenLight.position.copy(this.screen.position).add(new THREE.Vector3(0, 0, 0.1)); this.screenLight.lookAt(0, this.screen.position.y, 20); this.screenLight.name = 'luz del mural'; s.add(this.screenLight);
    // siluetas: sobre los techos y a los costados
    this.sil = buildSilhouettes(M, [[-6.2, 3.55, 2.2], [-8.4, 3.55, 5.5], [6.5, 3.55, 3.4], [8.2, 3.55, 6.2], [-9.6, 0, 9.5], [9.4, 0, 10.2], [-10.5, 0, 12.5], [10.8, 0, 13.1, 1.68]]);
    s.add(this.sil);
    // humo / polvo con paralaje
    const n = 3000, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = Math.random() * 9; pos[i * 3 + 2] = -1 + Math.random() * 18; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaa8888, size: 0.025, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })); this.dust.name = 'humo'; this.dust.userData.helper = true; s.add(this.dust);
    // ---------- artefactos ----------
    this.fx = [];
    const tubeGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 14, 1); tubeGeo.rotateX(Math.PI / 2);
    for (const f of this.rig.fixtures) {
      const grp = new THREE.Group(); grp.name = f.id; grp.position.fromArray(f.pos);
      if (f.px) {
        const tex = new THREE.DataTexture(new Float32Array(f.pixels * 4), f.pixels, 1, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true;
        const mat = new THREE.ShaderMaterial({ uniforms: { px: { value: tex }, glow: { value: 1.6 }, pixels: { value: f.pixels } }, vertexShader: tubeVert, fragmentShader: tubeFrag });
        const m = new THREE.Mesh(tubeGeo, mat); m.scale.set(1.4, 1.4, f.length); m.position.z = f.length / 2;
        grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().fromArray(f.dir).normalize());
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), M.metal), m);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), M.metal); cap.position.z = f.length; grp.add(cap);
        const light = new THREE.PointLight(0xffffff, 0, 7, 1.6); light.position.z = f.length / 2; grp.add(light);
        this.fx.push({ f, grp, tex, light });
      } else if (f.type === 'area') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(f.length, 0.08, 0.14), M.dark); grp.add(body);
        const lens = new THREE.Mesh(new THREE.PlaneGeometry(f.length - 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff })); lens.rotation.x = -Math.PI / 2; lens.position.y = -0.045; grp.add(lens);
        const light = new THREE.RectAreaLight(0xffffff, 0, f.length, 0.12); light.position.y = -0.06; light.lookAt(0, -1, 0); grp.add(light);
        const beam = new Beam({ angle: 0.95, length: 3.6, haze: 0.3, falloff: 0.06 }); beam.position.y = -0.05; beam.rotation.x = Math.PI / 2; grp.add(beam);
        this.fx.push({ f, grp, lens, light, beam });
      } else if (f.type === 'cabeza') {
        const yoke = new THREE.Group(), head = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.3), M.dark); grp.add(body);
        for (const sd of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.09), M.dark); arm.position.set(sd * 0.17, -0.2, 0); yoke.add(arm); }
        yoke.position.y = -0.07;
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.38, 20), M.dark); lamp.rotation.x = Math.PI / 2; head.add(lamp);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.095, 20), new THREE.MeshBasicMaterial({ color: 0xffffff })); lens.position.z = 0.2; head.add(lens);
        const beam = new Beam({ angle: 0.13, length: 16, haze: 0.5, falloff: 0.01 }); beam.position.z = 0.2; head.add(beam);
        const spot = new THREE.SpotLight(0xffffff, 0, 30, 0.16, 0.5, 1.4); spot.position.set(0, 0, 0.2); spot.target.position.set(0, 0, 12); head.add(spot, spot.target);
        head.position.y = -0.28; yoke.add(head); grp.add(yoke);
        this.fx.push({ f, grp, yoke, head, lens, beam, spot });
      } else if (f.type === 'wash') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), M.dark); grp.add(body);
        const aim = new THREE.Vector3().fromArray(f.aim); const pivot = new THREE.Group(); pivot.lookAt(aim.clone().sub(grp.position)); grp.add(pivot);
        const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff })); lens.position.z = 0.12; pivot.add(lens);
        const beam = new Beam({ angle: 0.55, length: 5, haze: 0.35, falloff: 0.05 }); beam.position.z = 0.1; pivot.add(beam);
        const spot = new THREE.SpotLight(0xffffff, 0, 10, 0.7, 0.8, 1.2); spot.position.z = 0.1; spot.target.position.set(0, 0, 5); pivot.add(spot, spot.target);
        this.fx.push({ f, grp, lens, beam, spot });
      }
      s.add(grp);
    }
    this.params.onChange((id, v) => { if (id === 'escenario.siluetas') this.sil.visible = v; if (id === 'escenario.charcos') { this.floor.uniforms.reflectAmt.value = 0.5 + 0.5 * v; } });
    this.subject.center.set(0, 3, 0); this.subject.radius = 8; this.subject.distance = 16;
    this.pmrem = new THREE.PMREMGenerator(this.app.renderer);
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envScene.add(this.envSky);
  }

  /** La escena que se proyecta: la instancia que ya tiene la app. */
  content() {
    const key = this.v('contenido');
    const list = Array.isArray(this.app.scenes) ? this.app.scenes : Object.values(this.app.scenes || {});
    const sc = list.find((x) => x.key === key);
    if (sc && !sc.built) sc.ensureBuilt();
    return sc || null;
  }

  update(dt, t) {
    const c = this.cues, v = (n) => this.v(n), rig = this.rig, trig = this.app.music?.triggers;
    // contenido proyectado
    const sc = this.content();
    if (sc && sc !== this) {
      sc.update(dt, t);
      const r = this.app.renderer, prev = r.getRenderTarget();
      const cam = sc.camera; cam.aspect = this.rt.width / this.rt.height; cam.updateProjectionMatrix();
      r.setRenderTarget(this.rt); r.setClearColor(0x000000, 1); r.clear(); r.render(sc.scene, cam); r.setRenderTarget(prev);
    }
    this.screenMat.color.setScalar(v('pantallaBrillo'));
    this.screenLight.intensity = 1.5 * v('pantallaBrillo') * (0.4 + 0.6 * c.loud);

    // rig → artefactos virtuales
    rig.update(c, dt, trig, this.lookahead, this.app.kaossLights);
    const haze = v('humo'), secCol = rig.sectionColor;
    for (const x of this.fx) {
      const f = x.f;
      if (f.px) {
        const d = x.tex.image.data; let sr = 0, sg = 0, sb = 0;
        for (let i = 0; i < f.pixels; i++) { d[i * 4] = f.px[i * 3]; d[i * 4 + 1] = f.px[i * 3 + 1]; d[i * 4 + 2] = f.px[i * 3 + 2]; d[i * 4 + 3] = 1; sr += f.px[i * 3]; sg += f.px[i * 3 + 1]; sb += f.px[i * 3 + 2]; }
        x.tex.needsUpdate = true;
        const lum = (sr + sg + sb) / (3 * f.pixels);
        x.light.color.setRGB(sr, sg, sb).multiplyScalar(1 / Math.max(1e-3, Math.max(sr, sg, sb))); x.light.intensity = lum * 2.5;
      } else if (f.type === 'area') {
        x.light.color.copy(f.color); x.light.intensity = f.dimmer * 40;
        x.lens.material.color.copy(f.color).multiplyScalar(0.15 + f.dimmer * 6);
        x.beam.sync(t); x.beam.set(f.color, f.dimmer * 0.5, haze);
      } else if (f.type === 'cabeza') {
        x.yoke.rotation.y = f.pan; x.head.rotation.x = f.tilt;   // +tilt = hacia abajo y adelante
        x.beam.sync(t); x.beam.set(f.color, f.dimmer * 1.4, haze);
        x.lens.material.color.copy(f.color).multiplyScalar(0.2 + f.dimmer * 8);
        x.spot.color.copy(f.color); x.spot.intensity = f.dimmer * 600;
      } else if (f.type === 'wash') {
        x.beam.sync(t); x.beam.set(f.color, f.dimmer * 0.7, haze);
        x.lens.material.color.copy(f.color).multiplyScalar(0.2 + f.dimmer * 4); x.spot.color.copy(f.color); x.spot.intensity = f.dimmer * 90;
      }
    }
    this.artnet.send(rig, dt);
    this.dust.rotation.y += dt * 0.003;

    // cielo: el mundo destella con el trigger `cielo`; color de la sección
    const flash = Math.min(1, rig.sky * v('cielo'));
    const horizon = secCol.clone().multiplyScalar(1.0), zenith = secCol.clone().multiplyScalar(0.008), flashCol = secCol.clone().lerp(new THREE.Color(1, 0.8, 0.45), 0.6).multiplyScalar(1.8);
    this.sky.set(horizon, zenith, flashCol, flash, t, v('cieloBase'));
    this.scene.fog.color.copy(horizon).multiplyScalar(0.05 + flash * 0.25);
    if (this.app.stereo?.fx) this.app.stereo.fx.setTint(secCol);
    // entorno para los metales (del cielo), cada tanto
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 1.5;
      this.envSky.set(horizon, zenith, flashCol, 0, t, v('cieloBase') * 0.6);
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 500); this.envRT?.dispose(); this.envRT = rt; this.scene.environment = rt.texture;
    }

    // cámara
    const mode = v('camara'), cam = this.camera, H = v('altura'), D = v('distancia');
    if (mode === 'director') { this.subject.center.set(0, 3, 0); this.finish(dt); return; }
    if (mode === 'frontal') { cam.position.set(0, H, D); cam.lookAt(0, 2.6, 0); cam.fov = v('fov'); }
    else if (mode === 'público') { cam.position.set(Math.sin(t * 0.1) * 0.25, 1.7, 7 + Math.sin(t * 0.07) * 0.2); cam.lookAt(0, 3.2, 0); cam.fov = 58; }
    else if (mode === 'lateral') { cam.position.set(-16, 3.5, 7); cam.lookAt(0, 2.8, 2); cam.fov = 50; }
    else { cam.position.set(0, 14, 9); cam.lookAt(0, 0, 2); cam.fov = 55; }
    cam.updateProjectionMatrix();
    const k = this.v2('fourier.intensidad');
    this.kick = Math.max(this.kick * Math.exp(-dt * 8), c.bands[0].hit * k); this.flash *= Math.exp(-dt * 6);
  }
}
