import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';
import { requestAsset } from './diosas/assets.js';
import { Figure, geometryFromArrays } from './diosas/Figure.js';
import { Cosmos } from './diosas/cosmos.js';
import { sharedUniforms, goldMaterial, gemMaterial } from './diosas/materials.js';
import { MOTIONS, MOTION_NAMES, POSE_KEYS, emptyPose } from './diosas/motions.js';
import { PALETTES, PALETTE_NAMES, PALETTE_KEYS } from './diosas/palettes.js';
import { HEADDRESSES } from './diosas/ornaments.js';
import { loadModelTemplate, readStoredModel, storeModelFile, forgetStoredModel, pickModelFile } from './diosas/model.js';

/**
 * DIOSAS: retratos psicodélicos de mujeres de mundos espirituales, a partir
 * de los videos de References/. Hiper-detalle en rostro, ojos y joyería,
 * contraste de color neón y capas de profundidad (cúpula, galaxia, halos,
 * cintas de luz que giran alrededor de la cabeza, destellos que salen del
 * mural) pensadas para cross-eye y anaglifo.
 *
 * Todo es procedural (sin modelos externos): la anatomía es una SDF que se
 * malla en un worker (diosas/anatomy.js), el pelo crece por hebras, los ojos
 * son un shader con iris, córnea y refracción.
 *
 * Control (todo en el bus de parámetros → MIDI / OSC / ESP32 / audio):
 *   diosas.ritmo.*       tempo: reloj interno, MIDI clock de Ableton, audio o tap
 *   diosas.movimiento.*  biblioteca de gestos en beats, transición, desfase entre figuras
 *   diosas.mirada.*      a quién miran (espectador, puntero, sensor, cámara…), presencia, parpadeo
 *   diosas.ojos.*        color de iris, pupila, brillo, esclerótica
 *   diosas.color.*       paletas, tono, ciclo de color al ritmo
 *   diosas.piel / pelo / joyas / fondo / camara
 */
const LAYOUT = [
  { pos: [0, 0, 0], rotY: 0, tocado: 'luna', pelo: 'flequillo', seed: 1, dim: 1 },
  { pos: [-3.8, 0.6, -6], rotY: 0.3, tocado: 'sol', pelo: 'ondas', seed: 2, dim: 0.5 },
  { pos: [3.8, 0.6, -6], rotY: -0.3, tocado: 'espinas', pelo: 'flequillo', seed: 3, dim: 0.5 },
  { pos: [-8, 1.4, -14], rotY: 0.42, tocado: 'espinas', pelo: 'ondas', seed: 4, dim: 0.35 },
  { pos: [8, 1.4, -14], rotY: -0.42, tocado: 'luna', pelo: 'ondas', seed: 5, dim: 0.35 },
];
export const GAZE_MODES = ['espectador', 'puntero', 'sensor', 'cámara', 'deriva', 'entre ellas', 'cielo'];
const RHYTHM_SOURCES = ['interno', 'midi clock', 'audio'];

const _c = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 }, _v = new THREE.Vector3(), _v2 = new THREE.Vector2();
const _off = new THREE.Vector3(), _tgt = new THREE.Vector3(), _iris1 = new THREE.Color(), _iris2 = new THREE.Color(), _sclera = new THREE.Color();

export class DiosasScene extends BaseScene {
  static id = 'diosas';
  static title = 'Diosas';
  static category = 'Retratos';
  constructor(app) {
    super(app, 'diosas', 'Diosas');
    this.camera.fov = 24; this.camera.near = 0.1; this.camera.far = 300;
    this.camera.position.set(0, -0.35, 10);
    this.beat = 0; this.mBeat = 0; this.lastBeatInt = 0; this.bar = 0;
    this.pulse = 0; this.hueCycle = 0;
    this.taps = [];
    this.audioBeatT = 0;
    this.pointer = new THREE.Vector2();
    this.look = new THREE.Vector2();
    this.motion = { from: 'trance', to: 'trance', k: 1 };
    this.pal = { from: {}, to: {}, cur: {}, k: 1 };
    this.envTimer = 0; this.envDirty = true;
    this.geoCache = new Map();
    this.editorUsesSceneCamera = true;   // las mallas llegan del worker: el editor arranca con la vista de la escena
  }

  defineParams() {
    const p = (n, o) => this.p(n, o);
    p('cantidad', { min: 1, max: 5, default: 3, step: 1, label: 'cantidad de diosas' });
    p('calidad', { type: 'option', options: ['baja', 'media', 'alta'], default: 'media', label: 'calidad de malla' });
    p('velocidad', { min: 0, max: 3, default: 1, step: 0.01, label: 'velocidad general' });

    p('ritmo.fuente', { type: 'option', options: RHYTHM_SOURCES, default: 'interno', label: 'fuente del tempo' });
    p('ritmo.bpm', { min: 40, max: 200, default: 96, step: 0.1, label: 'bpm' });
    p('ritmo.beat', { type: 'trigger', label: 'beat / tap tempo' });
    p('ritmo.pulso', { min: 0, max: 2, default: 0.8, step: 0.01, label: 'destello en cada beat' });
    p('ritmo.audio', { min: 0, max: 2, default: 1, step: 0.01, label: 'reacción al audio' });

    p('movimiento.tipo', { type: 'option', options: MOTION_NAMES, default: 'trance', label: 'movimiento' });
    p('movimiento.siguiente', { type: 'trigger', label: 'siguiente movimiento' });
    p('movimiento.auto', { default: true, label: 'cambiar solo' });
    p('movimiento.compases', { min: 1, max: 32, default: 8, step: 1, label: 'cambiar cada N compases' });
    p('movimiento.intensidad', { min: 0, max: 2, default: 1, step: 0.01, label: 'intensidad' });
    p('movimiento.velocidad', { min: 0.125, max: 4, default: 1, step: 0.005, label: 'velocidad (× tempo)' });
    p('movimiento.transicion', { min: 0.2, max: 8, default: 2.5, step: 0.1, label: 'transición (s)' });
    p('movimiento.desfase', { min: 0, max: 1, default: 0.25, step: 0.01, label: 'desfase entre diosas (compases)' });
    p('movimiento.boca', { min: 0, max: 1, default: 0.12, step: 0.01, label: 'labios entreabiertos' });
    p('movimiento.bocaAudio', { min: 0, max: 1, default: 0, step: 0.01, label: 'boca sigue el audio (canto)' });

    p('mirada.modo', { type: 'option', options: GAZE_MODES, default: 'espectador', label: 'miran a' });
    p('mirada.x', { min: -1, max: 1, default: 0, step: 0.001, label: 'sensor x' });
    p('mirada.y', { min: -1, max: 1, default: 0, step: 0.001, label: 'sensor y' });
    p('mirada.presencia', { min: 0, max: 1, default: 1, step: 0.001, label: 'presencia (0 = trance, 1 = te miran)' });
    p('mirada.cabeza', { min: 0, max: 1, default: 0.35, step: 0.01, label: 'la cabeza acompaña' });
    p('mirada.velocidad', { min: 0.1, max: 3, default: 1, step: 0.01, label: 'velocidad de la mirada' });
    p('mirada.micro', { min: 0, max: 1, default: 0.4, step: 0.01, label: 'microsacadas' });
    p('mirada.parpadeo', { min: 0, max: 40, default: 11, step: 0.5, label: 'parpadeos por minuto' });
    p('mirada.parpadear', { type: 'trigger', label: 'parpadear' });
    p('mirada.apertura', { min: 0.2, max: 1.15, default: 0.78, step: 0.01, label: 'apertura de párpados' });

    p('ojos.tono', { min: 0, max: 1, default: 0.11, step: 0.001, label: 'color de iris' });
    p('ojos.tono2', { min: 0, max: 1, default: 0.15, step: 0.001, label: 'color anillo interior' });
    p('ojos.saturacion', { min: 0, max: 1, default: 0.95, step: 0.01, label: 'saturación iris' });
    p('ojos.brillo', { min: 0, max: 4, default: 1.1, step: 0.01, label: 'brillo de los ojos' });
    p('ojos.pupila', { min: 0.12, max: 0.75, default: 0.3, step: 0.005, label: 'pupila' });
    p('ojos.pupilaAudio', { min: 0, max: 1, default: 0.3, step: 0.01, label: 'pupila late con el bajo' });
    p('ojos.iris', { min: 0.4, max: 0.8, default: 0.64, step: 0.005, label: 'tamaño del iris' });
    p('ojos.esclera', { type: 'option', options: ['blanca', 'negra', 'color'], default: 'blanca', label: 'esclerótica' });
    p('ojos.heterocromia', { min: 0, max: 0.5, default: 0, step: 0.001, label: 'heterocromía' });
    p('ojos.variacion', { min: 0, max: 0.5, default: 0.08, step: 0.001, label: 'variación entre diosas' });

    p('color.paleta', { type: 'option', options: PALETTE_NAMES, default: 'eco', label: 'paleta' });
    p('color.siguiente', { type: 'trigger', label: 'siguiente paleta' });
    p('color.autoCompases', { min: 0, max: 64, default: 0, step: 1, label: 'cambiar paleta cada N compases (0 = no)' });
    p('color.transicion', { min: 0, max: 12, default: 3, step: 0.1, label: 'transición de paleta (s)' });
    p('color.tono', { min: 0, max: 1, default: 0, step: 0.001, label: 'rotación de tono' });
    p('color.ciclo', { min: 0, max: 2, default: 0, step: 0.01, label: 'ciclo de tono (vueltas / 16 beats)' });
    p('color.saturacion', { min: 0, max: 1.5, default: 1, step: 0.01, label: 'saturación' });
    p('color.brillo', { min: 0.2, max: 2, default: 1, step: 0.01, label: 'brillo' });
    p('color.contraluz', { min: 0, max: 3, default: 1.2, step: 0.01, label: 'contraluz (borde)' });
    p('color.maquillaje', { min: 0, max: 1.5, default: 1, step: 0.01, label: 'maquillaje' });

    p('piel.flujo', { min: 0, max: 1, default: 0.18, step: 0.01, label: 'flujo psicodélico (cuerpo)' });
    p('piel.flujoRostro', { min: 0, max: 1, default: 0.2, step: 0.01, label: 'flujo en el rostro' });
    p('piel.escala', { min: 0.3, max: 5, default: 1.6, step: 0.01, label: 'escala del flujo' });
    p('piel.velocidad', { min: 0, max: 3, default: 0.5, step: 0.01, label: 'velocidad del flujo' });
    p('piel.lineas', { min: 0, max: 2, default: 0.3, step: 0.01, label: 'líneas doradas' });

    p('pelo.estilo', { type: 'option', options: ['variado', 'flequillo', 'ondas'], default: 'variado', label: 'peinado' });
    p('pelo.balanceo', { min: 0, max: 3, default: 1, step: 0.01, label: 'balanceo' });
    p('pelo.flotar', { min: 0, max: 2, default: 0, step: 0.01, label: 'flotar (gravedad cero)' });

    p('joyas.tocado', { type: 'option', options: ['variado', ...HEADDRESSES], default: 'variado', label: 'tocado' });
    p('joyas.brillo', { min: 0, max: 3, default: 1, step: 0.01, label: 'brillo de gemas' });
    p('joyas.halo', { min: 0, max: 2, default: 0.45, step: 0.01, label: 'halo / mandala' });
    p('joyas.petalos', { min: 3, max: 16, default: 8, step: 1, label: 'pétalos del mandala' });
    p('joyas.giro', { min: -1, max: 1, default: 0.12, step: 0.01, label: 'giro del mandala' });

    p('fondo.intensidad', { min: 0, max: 2, default: 0.5, step: 0.01, label: 'intensidad' });
    p('fondo.marmol', { min: 0, max: 1, default: 0.7, step: 0.01, label: 'mármol líquido' });
    p('fondo.galaxia', { min: 0, max: 2, default: 0.8, step: 0.01, label: 'galaxia' });
    p('fondo.remolino', { min: 0, max: 3, default: 1, step: 0.01, label: 'remolino' });
    p('fondo.velocidad', { min: 0, max: 3, default: 0.4, step: 0.01, label: 'velocidad' });
    p('fondo.escala', { min: 0.3, max: 5, default: 1.6, step: 0.01, label: 'escala' });
    p('fondo.estrellas', { min: 0, max: 2, default: 1, step: 0.01, label: 'estrellas' });
    p('fondo.particulas', { min: 0, max: 2, default: 1, step: 0.01, label: 'partículas de la galaxia' });
    p('fondo.cintas', { min: 0, max: 8, default: 4, step: 1, label: 'cintas de luz' });
    p('fondo.cintasBrillo', { min: 0, max: 2, default: 0.55, step: 0.01, label: 'brillo de cintas' });
    p('fondo.destellos', { min: 0, max: 2, default: 0.7, step: 0.01, label: 'destellos' });

    p('modelo.usar', { default: true, label: 'usar modelo GLB (si hay)' });
    p('modelo.cargar', { type: 'trigger', label: 'cargar modelo GLB…' });
    p('modelo.olvidar', { type: 'trigger', label: 'olvidar modelo cargado' });
    p('modelo.escala', { min: 0.3, max: 3, default: 1, step: 0.01, label: 'escala' });
    p('modelo.altura', { min: -3, max: 3, default: 0, step: 0.01, label: 'altura' });
    p('modelo.adelante', { min: -3, max: 3, default: 0, step: 0.01, label: 'adelante / atrás' });
    p('modelo.brazos', { min: 0, max: 90, default: 72, step: 0.5, label: 'bajar brazos (pose T, °)' });
    p('modelo.neon', { min: 0, max: 1, default: 0.75, step: 0.01, label: 'iluminación neón de la paleta' });
    p('modelo.ojos', { min: 0, max: 1.5, default: 1, step: 0.01, label: 'movimiento de ojos' });
    p('modelo.joyas', { default: false, label: 'mantener joyas procedurales' });

    p('camara.distancia', { min: 4, max: 30, default: 10, step: 0.01, label: 'distancia' });
    p('camara.altura', { min: -4, max: 2, default: -0.5, step: 0.01, label: 'altura' });
    p('camara.fov', { min: 12, max: 80, default: 24, step: 0.1, label: 'fov' });
    p('camara.deriva', { min: 0, max: 1, default: 0.3, step: 0.01, label: 'deriva' });
    p('camara.paralaje', { min: 0, max: 1, default: 0.35, step: 0.01, label: 'paralaje con el puntero' });
    p('camara.pulso', { min: 0, max: 1, default: 0, step: 0.01, label: 'zoom en el beat' });
  }

  /** Geometría compartida entre figuras (se malla una sola vez por calidad). */
  assets(kind, args) {
    const key = `${kind}:${JSON.stringify(args)}`;
    if (!this.geoCache.has(key)) this.geoCache.set(key, requestAsset(kind, args).then((arrays) => ({ arrays, geometry: geometryFromArrays(arrays) })));
    return this.geoCache.get(key);
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x000000);
    this.U = sharedUniforms();
    this.mats = { gold: goldMaterial(), gem: gemMaterial(), gem2: gemMaterial() };
    this.mats.gem2.name = 'gema 2';

    // luces para el oro y las gemas (la piel usa su propio modelo con las mismas direcciones)
    this.lights = {
      key: new THREE.DirectionalLight(0xffffff, 3), fill: new THREE.DirectionalLight(0xffffff, 1.4),
      rim: new THREE.DirectionalLight(0xffffff, 3), amb: new THREE.AmbientLight(0xffffff, 0.4),
    };
    this.lights.key.name = 'luz principal'; this.lights.fill.name = 'luz de relleno'; this.lights.rim.name = 'contraluz'; this.lights.amb.name = 'ambiente';
    this.lights.key.position.copy(this.U.uKeyDir.value).multiplyScalar(10);
    this.lights.fill.position.copy(this.U.uFillDir.value).multiplyScalar(10);
    this.lights.rim.position.copy(this.U.uRimDir.value).multiplyScalar(10);
    s.add(this.lights.key, this.lights.fill, this.lights.rim, this.lights.amb);

    this.cosmos = new Cosmos(this.U);
    s.add(this.cosmos.group);

    this.ctx = { U: this.U, mats: this.mats, quality: this.v('calidad'), assets: (k, a) => this.assets(k, a) };
    this.figures = LAYOUT.map((d, i) => {
      const f = new Figure(i, { ...d }, this.ctx);
      s.add(f.root);
      return f;
    });
    this.applyStyles();

    // entorno para reflejos (se regenera cuando cambia la paleta)
    this.buildEnv();
    this.startPalette(this.v('color.paleta'), true);

    this.loadModel();

    this.params.onChange((id, value) => {
      if (!id.startsWith('diosas.')) return;
      const k = id.slice(7);
      if (k === 'modelo.cargar') this.pickModel();
      else if (k === 'modelo.olvidar') forgetStoredModel().then(() => this.loadModel());
      else if (k === 'modelo.usar') this.applyModel();
      else if (k === 'ritmo.beat') this.tap();
      else if (k === 'movimiento.tipo') this.startMotion(value);
      else if (k === 'movimiento.siguiente') this.nextMotion();
      else if (k === 'color.paleta') this.startPalette(value);
      else if (k === 'color.siguiente') this.params.set('diosas.color.paleta', PALETTE_NAMES[(PALETTE_NAMES.indexOf(this.v('color.paleta')) + 1) % PALETTE_NAMES.length], 'scene');
      else if (k === 'mirada.parpadear') this.blinkNow = true;
      else if (k === 'joyas.tocado' || k === 'pelo.estilo') this.applyStyles();
      else if (k === 'fondo.cintas') this.cosmos.setRibbonCount(Math.round(value));
      else if (k === 'calidad') this.setQuality(value);
    });
  }

  // ---------- modelo GLB provisorio ----------
  log(m) { (this.app.log ? this.app.log(m) : console.log('[diosas]', m)); }

  /** Carga el modelo guardado (IndexedDB) o public/modelos/diosa.glb; si no hay, queda la anatomía procedural. */
  async loadModel(buffer = null) {
    try {
      const stored = buffer ? null : await readStoredModel();
      const src = buffer || stored?.buffer || `${import.meta.env?.BASE_URL ?? '/'}modelos/diosa.glb`;
      const tpl = await loadModelTemplate(src);
      this.modelTemplate = tpl;
      if (tpl) {
        const r = tpl.rig;
        this.log(`modelo: ${tpl.info.title}${tpl.info.author ? ` — ${tpl.info.author}` : ''} (${tpl.info.license || 'licencia ?'})`);
        this.log(r.ok ? `esqueleto: ${r.boneCount} huesos · cabeza ${r.head} · cuello ${r.neck} · ojos ${r.eyes.map((e) => e.bone).join('/') || '—'} · brazos ${r.arms.map((a) => a.bone).join('/') || '—'}` : `modelo sin esqueleto utilizable (${r.reason})`);
      }
    } catch (e) { this.modelTemplate = null; this.log(`modelo: no se pudo cargar (${e.message})`); }
    this.applyModel();
  }

  async pickModel() {
    const f = await pickModelFile();
    if (!f) return;
    await storeModelFile(f.buffer, f.name);
    this.log(`modelo guardado: ${f.name}`);
    this.loadModel(f.buffer.slice(0));
  }

  applyModel() {
    const tpl = this.v('modelo.usar') ? this.modelTemplate : null;
    for (const f of this.figures) f.setModel(tpl);
    const i = tpl?.info;
    this.credits = i ? `modelo: "${i.title}" — ${i.author} · ${i.license}` : '';
  }

  applyStyles() {
    const toc = this.v('joyas.tocado'), pelo = this.v('pelo.estilo');
    this.figures.forEach((f, i) => {
      const t = toc === 'variado' ? LAYOUT[i].tocado : toc;
      if (f.ready && f.headdress?.name !== `tocado (${t})`) f.setHeaddress(t);
      f.def.tocado = t;
      f.setHair(pelo === 'variado' ? LAYOUT[i].pelo : pelo);
    });
  }

  async setQuality(q) {
    this.ctx.quality = q;
    for (const f of this.figures) {
      if (!f.ready) continue;
      const [head, body, hair] = await Promise.all([this.assets('head', { quality: q }), this.assets('body', { quality: q }), this.assets('hair', { quality: q, style: f.def.pelo, seed: 1 })]);
      f.face.geometry = head.geometry; f.body.geometry = body.geometry; f.hair.geometry = hair.geometry;
    }
  }

  // ---------- entorno / reflejos ----------
  buildEnv() {
    this.envScene = new THREE.Scene();
    this.envU = { cTop: { value: new THREE.Color() }, cMid: { value: new THREE.Color() }, cBot: { value: new THREE.Color() }, cS1: { value: new THREE.Color() }, cS2: { value: new THREE.Color() } };
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.envU, side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 cTop, cMid, cBot, cS1, cS2; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); vec3 c = mix(cBot, cMid, smoothstep(-0.7, 0.0, d.y)); c = mix(c, cTop, smoothstep(0.0, 0.9, d.y));
        c += cS1 * smoothstep(0.82, 0.96, dot(d, normalize(vec3(-0.6, 0.5, 0.7)))) * 5.0;
        c += cS2 * smoothstep(0.8, 0.95, dot(d, normalize(vec3(0.5, 0.4, -0.8)))) * 5.0;
        c += vec3(1.0) * smoothstep(0.97, 0.995, dot(d, normalize(vec3(0.2, 0.9, 0.3)))) * 3.0;
        gl_FragColor = vec4(c, 1.0); }`,
    })));
    this.pmrem = new THREE.PMREMGenerator(this.app.renderer);
  }

  updateEnv(dt) {
    this.envTimer -= dt;
    if (!this.envDirty || this.envTimer > 0) return;
    this.envDirty = false; this.envTimer = 0.3;
    const U = this.U, E = this.envU;
    E.cTop.value.copy(U.cKey.value).multiplyScalar(0.6); E.cMid.value.copy(U.cSkin.value).multiplyScalar(0.5); E.cBot.value.copy(U.cShadow.value);
    E.cS1.value.copy(U.cKey.value); E.cS2.value.copy(U.cRim.value);
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 50);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  // ---------- paleta ----------
  startPalette(name, instant = false) {
    const target = PALETTES[name] || PALETTES.eco;
    for (const k of PALETTE_KEYS) {
      this.pal.from[k] = (this.pal.cur[k] || new THREE.Color(target[k])).clone();
      this.pal.to[k] = new THREE.Color(target[k]);
      if (!this.pal.cur[k]) this.pal.cur[k] = new THREE.Color(target[k]);
    }
    this.pal.k = instant ? 1 : 0;
  }

  updatePalette(dt) {
    const P = this.pal, dur = this.v('color.transicion');
    P.k = Math.min(1, P.k + (dur > 0 ? dt / dur : 1));
    const e = P.k * P.k * (3 - 2 * P.k);
    const hue = this.v('color.tono') + this.hueCycle, sat = this.v('color.saturacion'), bri = this.v('color.brillo');
    const U = this.U;
    const map = { shadow: 'cShadow', skin: 'cSkin', key: 'cKey', rim: 'cRim', accent: 'cAccent', gem: 'cGem', makeup: 'cMakeup', hair: 'cHair', bg0: 'cBg0', bg1: 'cBg1', bg2: 'cBg2' };
    for (const k of PALETTE_KEYS) {
      P.cur[k].copy(P.from[k]).lerp(P.to[k], e);
      _c.copy(P.cur[k]).getHSL(_hsl);
      _c.setHSL(_hsl.h + hue, Math.min(1, _hsl.s * sat), _hsl.l).multiplyScalar(bri);
      const u = U[map[k]].value;
      if (!u.equals(_c)) { u.copy(_c); this.envDirty = true; }
    }
    // joyas y luces
    const glow = this.v('joyas.brillo') * (1 + this.pulse * 0.8);
    this.mats.gold.color.copy(U.cAccent.value); this.mats.gold.emissive.copy(U.cAccent.value).multiplyScalar(0.04);
    this.mats.gem.color.copy(U.cGem.value); this.mats.gem.emissive.copy(U.cGem.value); this.mats.gem.emissiveIntensity = 0.55 * glow;
    this.mats.gem2.color.copy(U.cRim.value); this.mats.gem2.emissive.copy(U.cRim.value); this.mats.gem2.emissiveIntensity = 0.35 * glow;
    this.lights.key.color.copy(U.cKey.value); this.lights.fill.color.copy(U.cSkin.value); this.lights.rim.color.copy(U.cRim.value); this.lights.amb.color.copy(U.cShadow.value);
  }

  // ---------- ritmo ----------
  tap() {
    const now = performance.now() / 1000;
    this.taps = this.taps.filter((x) => now - x < 2.5);
    this.taps.push(now);
    if (this.taps.length >= 2) {
      const iv = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      if (iv > 0.25 && iv < 1.6 && this.v('ritmo.fuente') !== 'midi clock') this.params.set('diosas.ritmo.bpm', 60 / iv, 'tap');
    }
    this.beat = Math.round(this.beat + 0.25);   // el tap cae en un beat
    this.pulse = 1;
  }

  updateRhythm(dt) {
    const src = this.v('ritmo.fuente');
    const clock = this.app.midi?.clock;
    const audio = this.app.audio;
    let bpm = this.v('ritmo.bpm');
    if (src === 'midi clock' && clock?.running) {
      this.beat = clock.position();
      if (clock.bpm > 0 && Math.abs(clock.bpm - bpm) > 0.4) this.params.set('diosas.ritmo.bpm', clock.bpm, 'clock');
    } else {
      this.beat += (dt * bpm) / 60;
      if (src === 'audio' && audio?.beat) {
        const now = performance.now() / 1000, iv = now - this.audioBeatT;
        this.audioBeatT = now;
        if (iv > 0.28 && iv < 1.5) { bpm = bpm * 0.8 + (60 / iv) * 0.2; this.params.set('diosas.ritmo.bpm', bpm, 'audio'); }
        this.beat += (Math.round(this.beat) - this.beat) * 0.5;
      }
    }
    const bi = Math.floor(this.beat);
    if (bi !== this.lastBeatInt) {
      const forward = bi > this.lastBeatInt;
      this.lastBeatInt = bi;
      if (forward) this.onBeat(bi);
    }
  }

  onBeat(n) {
    this.pulse = 1;
    if (this.v('ritmo.fuente') !== 'audio') this.app.emit?.('beat', { scene: 'diosas', n });
    if (n % 4 !== 0) return;
    this.bar = n / 4;
    const every = Math.max(1, Math.round(this.v('movimiento.compases')));
    if (this.v('movimiento.auto') && this.bar % every === 0) this.nextMotion();
    const pe = Math.round(this.v('color.autoCompases'));
    if (pe > 0 && this.bar % pe === 0) this.params.set('diosas.color.siguiente', 1, 'scene');
  }

  // ---------- movimiento ----------
  nextMotion() {
    const i = (MOTION_NAMES.indexOf(this.v('movimiento.tipo')) + 1) % MOTION_NAMES.length;
    this.params.set('diosas.movimiento.tipo', MOTION_NAMES[i], 'scene');
  }

  startMotion(name) {
    if (!MOTIONS[name] || name === this.motion.to) return;
    this.motion.from = this.motion.k < 0.5 ? this.motion.from : this.motion.to;
    this.motion.to = name; this.motion.k = 0;
  }

  poseFor(i, t, out) {
    const M = this.motion;
    const b = this.mBeat - i * this.v('movimiento.desfase') * 4;
    const r = LAYOUT[i].seed * 0.137;
    const a = emptyPose(this._pa || (this._pa = {})), c = emptyPose(this._pc || (this._pc = {}));
    MOTIONS[M.from](b, t, r, a); MOTIONS[M.to](b, t, r, c);
    const k = M.k * M.k * (3 - 2 * M.k);
    for (const key of POSE_KEYS) out[key] = a[key] + (c[key] - a[key]) * k;
    // respiración siempre presente
    out.pitch += 0.015 * Math.sin(t * 0.8 + r * 9); out.rise += 0.01 * Math.sin(t * 1.1 + r * 4);
    return out;
  }

  // ---------- eventos ----------
  onPointerMove(x, y) { this.pointer.set(x, y); }
  onLook(yaw, pitch) { this.look.set(THREE.MathUtils.degToRad(yaw), THREE.MathUtils.degToRad(pitch)); this.gyro = true; }

  // ---------- frame ----------
  update(dt, t) {
    const v = (n) => this.v(n);
    const speed = v('velocidad');
    const T = (this.T = (this.T || 0) + dt * speed);
    const prevBeat = this.beat;
    this.updateRhythm(dt);
    const dBeat = Math.max(0, this.beat - prevBeat);
    this.mBeat += dBeat * v('movimiento.velocidad');
    this.motion.k = Math.min(1, this.motion.k + dt / Math.max(0.2, v('movimiento.transicion')));

    const audio = this.app.audio;
    const ar = v('ritmo.audio');
    const bass = audio?.active ? audio.smooth.bass * ar : 0, high = audio?.active ? audio.smooth.high * ar : 0, level = audio?.active ? audio.smooth.level * ar : 0;
    this.pulse = Math.max(0, this.pulse - dt * 3.5);
    const pulse = Math.min(1.5, this.pulse * v('ritmo.pulso') + bass * 0.5);

    this.hueCycle += (v('color.ciclo') * dBeat) / 16;
    this.updatePalette(dt);
    this.updateEnv(dt);

    // uniforms compartidos
    const U = this.U;
    U.uTime.value = T; U.uPulse.value = pulse;
    U.uRimAmt.value = v('color.contraluz'); U.uGlow.value = v('joyas.brillo'); U.uMakeupAmt.value = v('color.maquillaje');
    U.uFlow.value = v('piel.flujo'); U.uFlowFace.value = v('piel.flujoRostro'); U.uFlowScale.value = v('piel.escala');
    U.uFlowSpeed.value = v('piel.velocidad'); U.uLines.value = v('piel.lineas');
    U.uSway.value = v('pelo.balanceo') * (1 + level); U.uFloat.value = v('pelo.flotar');

    // cosmos
    const C = this.cosmos;
    C.domeU.uSpeed.value = v('fondo.velocidad'); C.domeU.uSwirl.value = v('fondo.remolino'); C.domeU.uScale.value = v('fondo.escala');
    C.domeU.uIntensity.value = v('fondo.intensidad'); C.domeU.uGalaxy.value = v('fondo.galaxia'); C.domeU.uStars.value = v('fondo.estrellas'); C.domeU.uMarble.value = v('fondo.marmol');
    C.galaxyU.uIntensity.value = v('fondo.particulas') * (1 + bass); C.galaxyU.uSpin.value = 0.3 * v('fondo.velocidad') + 0.05;
    C.ribbonU.uIntensity.value = v('fondo.cintasBrillo'); C.ribbonU.uSpeed.value = v('fondo.velocidad') + 0.2;
    C.sparkU.uIntensity.value = v('fondo.destellos'); C.sparkU.uHigh.value = high;
    // en "mapa de profundidad" las capas de luz aditiva taparían todo: se ocultan
    const depthLook = !!this.params.get('look.depth');
    C.group.visible = !depthLook;
    C.galaxy.visible = v('fondo.particulas') > 0; C.sparks.visible = v('fondo.destellos') > 0; C.ribbons.visible = v('fondo.cintasBrillo') > 0;
    const size = this.app.renderer.getDrawingBufferSize(_v2);
    C.pixel.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    C.update(dt * speed, { ribbonSpin: 1 + bass });

    // cámara
    const cam = this.camera, dr = v('camara.deriva'), par = v('camara.paralaje');
    const camY = v('camara.altura');
    const kick = pulse * v('camara.pulso');
    cam.position.set(Math.sin(T * 0.13) * 0.5 * dr + this.pointer.x * 0.8 * par, camY + Math.sin(T * 0.17) * 0.18 * dr + this.pointer.y * 0.3 * par, v('camara.distancia') - kick * 0.6);
    cam.lookAt(cam.position.x * 0.3, camY, 0);
    if (this.gyro) { cam.rotateY(-this.look.x * 0.6); cam.rotateX(this.look.y * 0.6); }
    cam.fov = v('camara.fov');
    cam.updateMatrixWorld();

    // mirada
    const mode = v('mirada.modo');
    let presence = v('mirada.presencia');
    const camIn = this.app.camIn;
    const base = cam.position;
    const goal = _v.copy(base);
    // los puntos que miran están en el plano del público (x, y en -1..1 → ancho del mural aprox.)
    if (mode === 'puntero') goal.add(_off.set(this.pointer.x * 3.5, this.pointer.y * 2.2, 0));
    else if (mode === 'sensor') goal.add(_off.set(v('mirada.x') * 3.5, v('mirada.y') * 2.2, 0));
    else if (mode === 'cámara' && camIn?.active) { goal.add(_off.set(camIn.x * 3.5, camIn.y * 2.2, 0)); presence *= camIn.presence; }
    else if (mode === 'deriva') presence = 0;

    const count = Math.round(v('cantidad'));
    const s = this.frameState || (this.frameState = {});
    Object.assign(s, {
      camera: cam, presence, micro: v('mirada.micro'), gazeSpeed: v('mirada.velocidad'), headFollow: v('mirada.cabeza'),
      gazeUp: mode === 'cielo' ? 1 : 0, blinkRate: v('mirada.parpadeo'), blinkNow: false, openness: v('mirada.apertura'),
      amount: v('movimiento.intensidad'), mouth: v('movimiento.boca') + level * v('movimiento.bocaAudio') * 0.8,
      sway: v('pelo.balanceo') * (1 + level),
      modelScale: v('modelo.escala'), modelY: v('modelo.altura'), modelZ: v('modelo.adelante'), modelArms: v('modelo.brazos'),
      modelNeon: v('modelo.neon'), modelEyes: v('modelo.ojos'), modelJewels: v('modelo.joyas'),
    });
    s.modelFitKey = `${s.modelScale}|${s.modelY}|${s.modelZ}`;

    // ojos: colores
    const sat = v('ojos.saturacion');
    const scl = v('ojos.esclera');
    const sclera = scl === 'negra' ? _sclera.setRGB(0.02, 0.01, 0.03) : scl === 'color' ? _sclera.copy(U.cGem.value).multiplyScalar(0.6) : _sclera.setRGB(0.5, 0.47, 0.55).lerp(U.cSkin.value, 0.2);
    const eyeS = { iris: v('ojos.iris'), pupil: THREE.MathUtils.clamp(v('ojos.pupila') + v('ojos.pupilaAudio') * (bass * 0.3 + pulse * 0.08), 0.1, 0.85), eyeGlow: v('ojos.brillo') };

    const pose = this._pose || (this._pose = emptyPose());
    this.figures.forEach((f, i) => {
      f.visible = i < count;
      if (!f.root.visible && !f.visible) { f.update(dt, T, s, pose, goal); return; }
      const hv = i * v('ojos.variacion');
      f.setEyeColors(_iris1.setHSL(v('ojos.tono') + hv, sat, 0.5), _iris2.setHSL(v('ojos.tono2') + hv, sat, 0.62), sclera, eyeS, v('ojos.heterocromia'));
      s.blinkNow = !!this.blinkNow && (i === 0 || Math.random() < 0.9);
      this.poseFor(i, T, pose);
      let target = goal;
      if (mode === 'entre ellas' && count > 1) target = this.figures[(i + 1) % count].eyesWorld(_tgt);
      if (mode === 'cielo') target = f.root.localToWorld(_tgt.set(0, 30, 6));
      f.update(dt, T, s, pose, target);
      f.halo.material.uniforms.uHalo.value = v('joyas.halo');
      f.halo.material.uniforms.uPetals.value = Math.round(v('joyas.petalos'));
      f.halo.material.uniforms.uSpin.value = v('joyas.giro');
      f.halo.material.uniforms.uBass.value = bass;
      f.halo.visible = v('joyas.halo') > 0 && !depthLook;
    });
    this.blinkNow = false;
    // las cintas giran alrededor de la diosa principal
    C.ribbons.position.copy(this.figures[0].root.position).y += 0.2;
  }

  dispose() {
    this.figures?.forEach((f) => f.dispose());
    this.envRT?.dispose(); this.pmrem?.dispose();
    super.dispose();
  }
}
