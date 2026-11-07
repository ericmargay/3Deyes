import * as THREE from 'three';
import { BaseScene } from '../BaseScene.js';
import { IdleCues } from '../../music/Cues.js';
import { Director } from './Director.js';

/**
 * Base de las escenas de "Live Fourier Cinestesia".
 *
 * Convención de espacio (para que el estéreo sea coherente en todas):
 *   el tiempo corre hacia el espectador: lo que viene está adelante (sale del
 *   mural), el "ahora" queda en el plano de convergencia (stereo.focus) y el
 *   pasado se hunde en la pared. 1 beat = `beatLen` unidades.
 *
 * Cada cuadro, `this.cues` (del reproductor, del analizador en vivo o del
 * reloj interno) trae beats, compases, secciones, onsets por banda, notas…
 * El director (FLUID) decide la cámara sobre el `subject` que define la
 * escena, salvo que la escena pida la cámara fija.
 */
const idle = new IdleCues(100);

/** Look base de las escenas musicales; cada escena lo pisa con `this.look` (se aplica al entrar). */
export const BASE_LOOK = {
  'look.bloom': 0.8, 'look.bloomThreshold': 0.85, 'look.bloomRadius': 0.5, 'look.exposure': 1,
  'fx.tinte': 0, 'fx.contraste': 1.08, 'fx.saturacion': 1, 'fx.vineta': 0.35, 'fx.grano': 0.06,
  'fx.estela': 0, 'fx.caleidoscopio': 0, 'fx.prisma': 0, 'fx.giro': 0, 'fx.tunel': 0, 'fx.tono': 0,
};

/** Aspecto de diseño de las cámaras fijas: si el ojo es más angosto, se abre el campo hasta ese aspecto. */
const ENCUADRE = { recortar: 0, intermedio: 1.3, 'ajustar al ancho': 16 / 9 };

export const SECTION_COLORS = [[255, 79, 163], [60, 200, 255], [255, 190, 60], [120, 255, 140], [190, 120, 255], [255, 110, 70], [80, 255, 230], [255, 240, 120]];
export function sectionColor(type) { return SECTION_COLORS[((type % SECTION_COLORS.length) + SECTION_COLORS.length) % SECTION_COLORS.length]; }
export function sectionHue(type) { const c = sectionColor(type); return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255).getHSL({ h: 0, s: 0, l: 0 }).h; }

export const BAND_HUES = [0.0, 0.08, 0.33, 0.55, 0.78];   // sub rojo · grave naranja · medio verde · agudo cian · aire violeta
export const BAND_LABELS = ['sub', 'grave', 'medio', 'agudo', 'aire'];

export class MusicScene extends BaseScene {
  static category = 'Live Fourier Cinestesia';
  constructor(app, key, title) {
    super(app, key, title);
    this.camera.position.set(0, 0, 10); this.camera.near = 0.05; this.camera.far = 400;
    this.director = new Director(this);
    this.subject = { center: new THREE.Vector3(0, 0, 0), forward: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), radius: 4, distance: 10 };
    this.kick = 0; this.flash = 0;
    this.fixed = null;   // { pos, look, fov }: cámara fija de la escena (cuando el director está apagado)
    this._breath = new THREE.Vector3();
    this.look = {};      // parámetros de look / fx propios de la escena
    this.padLabels = null;   // rótulos del pad Kaoss (X, Y) para esta escena
    this.showPad = false;    // abrir el pad al entrar
  }

  enter() {
    super.enter();
    const p = this.params;
    if (p.get('fourier.lookEscena') !== false) for (const [id, v] of Object.entries({ ...BASE_LOOK, ...this.look })) if (p.has(id)) p.set(id, v, 'scene');
    const pad = this.app.kaoss;
    if (pad) { pad.setLabels(this.padLabels || { title: 'Kaoss', x: 'X', y: 'Y', programs: true }); if (this.showPad) pad.toggle(true); }
  }

  get cues() { return this.app.music?.cues ?? idle; }

  /** Parámetros compartidos por todas las escenas musicales (se definen una vez). */
  defineParams() {
    const p = this.params, d = (id, o) => { if (!p.has(id)) p.define(id, o); };
    d('fourier.anticipacion', { min: 0.2, max: 8, default: 2.5, step: 0.05, label: 'anticipación (s que se ven venir)' });
    d('fourier.umbral', { min: 0, max: 0.9, default: 0.25, step: 0.01, label: 'umbral de golpes (fuerza mínima)' });
    d('fourier.intensidad', { min: 0, max: 3, default: 1, step: 0.01, label: 'intensidad de reacción' });
    d('fourier.beatLen', { min: 0.3, max: 4, default: 1.2, step: 0.01, label: 'unidades por beat (profundidad)' });
    d('fourier.paleta', { type: 'option', options: ['neón', 'cálida', 'fría', 'mono'], default: 'neón', label: 'paleta' });
    d('fourier.tono', { min: 0, max: 1, default: 0, step: 0.001, label: 'rotación de tono' });
    d('fourier.notas', { default: true, label: 'mostrar notas (MIDI)' });
    d('fourier.lookEscena', { default: true, label: 'cada escena trae su look (bloom, fx) al entrar' });
    d('fourier.encuadre', { type: 'option', options: Object.keys(ENCUADRE), default: 'intermedio', label: 'encuadre en ojos angostos (lado a lado)' });
    this.director.defineParams();
  }

  v2(id) { return this.params.get(id); }
  get lookahead() { return this.v2('fourier.anticipacion'); }
  get threshold() { return this.v2('fourier.umbral'); }
  get beatLen() { return this.v2('fourier.beatLen'); }

  /** Color de una banda / sección según la paleta elegida. */
  hue(h) {
    const pal = this.v2('fourier.paleta'), rot = this.v2('fourier.tono');
    if (pal === 'mono') return (0.6 + rot) % 1;
    if (pal === 'cálida') return (0.95 + h * 0.2 + rot) % 1;
    if (pal === 'fría') return (0.5 + h * 0.3 + rot) % 1;
    return (h + rot) % 1;
  }
  bandColor(i, l = 0.6, s = 1) { return new THREE.Color().setHSL(this.hue(BAND_HUES[i]), s, l); }
  sectionColor(type, l = 0.6, s = 0.9) { return new THREE.Color().setHSL(this.hue(sectionHue(type)), s, l); }

  /** z de un instante: el ahora en 0, el futuro positivo (hacia la cámara). */
  zOf(t, now = this.cues.t) { return (t - now) / this.cues.beatDur * this.beatLen; }

  /** Llamar al final de update(): impulsos comunes y cámara. */
  finish(dt) {
    const c = this.cues, k = this.v2('fourier.intensidad');
    this.kick = Math.max(this.kick * Math.exp(-dt * 8), c.bands[0].hit * k);
    this.flash = Math.max(this.flash * Math.exp(-dt * 6), c.onDownbeat ? 0.8 * k : c.onBeat ? 0.35 * k : 0);
    if (!this.v2('director.activo') && this.fixed) {
      // cámara fija con una respiración mínima
      const br = this.v2('director.respirar') * 0.04, cam = this.camera, f = this.fixed;
      this._breath.set(Math.sin(c.t * 0.5) * br, Math.sin(c.t * 0.37 + 1) * br * 0.6, 0);
      cam.position.copy(f.pos).add(this._breath).addScaledVector(f.pos.clone().sub(f.look).normalize(), -this.director.punchIn(dt, c) * 0.25);
      cam.up.set(0, 1, 0); cam.lookAt(f.look); cam.fov = f.fov ?? 45; cam.updateProjectionMatrix();
      // en un ojo más angosto que 16:9 (estéreo lado a lado) se abre el campo según fourier.encuadre
      cam.userData.baseFov = cam.fov; cam.userData.designAspect = ENCUADRE[this.v2('fourier.encuadre')] ?? 0;
      return;
    }
    this.camera.userData.baseFov = 0;
    this.director.update(dt, c, this.subject, this.camera);
  }
}
