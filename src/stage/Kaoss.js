import * as THREE from 'three';
import { sectionHue } from '../scenes/music/MusicScene.js';

/**
 * Motor de luces estilo Kaoss Pad: devuelve el color de cualquier luz según
 * su posición (u, v) en el layout (0..1, izquierda→derecha, abajo→arriba).
 * Lo usan la escena "Kaoss estrobo" (artefactos virtuales) y el rig de luces
 * (Art-Net, artefactos reales): tocar el pad toca las luces de verdad.
 *
 * Pad:
 *   X   velocidad, cuantizada a la grilla del beat: 1/1 · 1/2 · 1/4 · 1/8 · 1/16 · 1/32
 *   Y   color: blanco → color de la sección → pares complementarios →
 *       arcoíris repartido en las luces → arcoíris que corre
 *   programa  estrobo · persecución · aleatorio · espejo · ola · tartamudeo
 *             (redoble que se acelera mientras se sostiene) · filtro (X
 *             elige la banda: las luces siguen al sub, al bajo… al aire) ·
 *             eco (cada destello se repite corrido y más débil)
 *
 * Sin tocar el pad (modo auto) dispara la música: bombo → destello blanco,
 * caja → damero de color, platillos → chispas, beat → paso de persecución,
 * sección → cegadora que se apaga.
 *
 * ⚠ Seguridad: las luces estroboscópicas pueden provocar crisis en personas
 * con epilepsia fotosensible. El modo seguro (por defecto) limita los
 * destellos de campo completo a 3 por segundo (criterio WCAG 2.3.1) y los
 * parciales a 8 por segundo por luz. Desactivarlo sólo con aviso al público.
 */
export const RATES = [0.25, 0.5, 1, 2, 4, 8];   // destellos por beat
export const RATE_LABELS = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'];
const hash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const _a = new THREE.Color(), _b = new THREE.Color();

export class KaossEngine {
  constructor(params) {
    this.params = params;
    const p = params, d = (id, o) => { if (!p.has(id)) p.define(id, o); };
    d('estrobo.seguro', { default: true, label: '⚠ modo seguro: máx. 3 destellos/s de campo completo (epilepsia fotosensible)' });
    d('estrobo.auto', { default: true, label: 'sin tocar el pad, dispara la música' });
    d('estrobo.duracion', { min: 10, max: 200, default: 40, step: 1, label: 'duración del destello (ms)' });
    d('estrobo.brillo', { min: 0, max: 2, default: 1, step: 0.01, label: 'brillo' });
    d('estrobo.fondo', { min: 0, max: 0.4, default: 0.04, step: 0.005, label: 'luz de fondo (con el bajo)' });
    this.t = 0; this.beatPos = 0; this.rate = 1; this.rateIndex = 2; this.tick = 0; this.tickT = -1; this.lastTick = -1;
    this.ticks = [];        // tiempos de los últimos destellos (para eco y envolventes)
    this.lastGlobal = -10;  // último destello de campo completo (limitador)
    this.kick = 0; this.kickT = -10; this.snare = 0; this.snareN = 0; this.blind = 0; this.bass = 0; this.hats = 0;
    this.chase = 0; this.touchBeat = 0; this.wasActive = false; this.secHue = 0; this.bpm = 120;
    this.active = false; this.x = 0.5; this.y = 0.5; this.program = 'estrobo';
  }

  get safe() { return this.params.get('estrobo.seguro'); }
  get rateLabel() { return RATE_LABELS[this.rateIndex]; }

  /** Por cuadro. pad: { x, y, active, program } (el KaossPad de la app). */
  update(c, dt, pad) {
    const p = this.params;
    this.t += dt;
    this.active = !!pad?.active; this.x = pad?.x ?? 0.5; this.y = pad?.y ?? 0.5; this.program = pad?.program ?? 'estrobo';
    this.beatPos = (c.beat ?? 0) + (c.beatPhase ?? 0);
    this.bpm = c.bpm || 60 / Math.max(0.2, c.beatDur || 0.5);
    this.secHue = sectionHue(c.section?.type ?? 0);
    const bps = this.bpm / 60;

    // velocidad: X cuantizada; el redoble (tartamudeo) se duplica en cada beat que se sostiene
    if (this.active && !this.wasActive) this.touchBeat = this.beatPos;
    this.wasActive = this.active;
    let idx = this.active ? Math.min(RATES.length - 1, Math.floor(this.x * RATES.length)) : 2;
    if (this.active && this.program === 'tartamudeo') idx = Math.min(RATES.length - 1, idx + Math.floor(this.beatPos - this.touchBeat));
    // limitador: campo completo ≤ 3 Hz, parcial ≤ 8 Hz
    if (this.safe) {
      const full = this.program === 'estrobo' || this.program === 'tartamudeo';
      const maxHz = full ? 3 : 8;
      while (idx > 0 && RATES[idx] * bps > maxHz) idx--;
    }
    this.rateIndex = idx; this.rate = RATES[idx];
    const tick = Math.floor(this.beatPos * this.rate);
    if (tick !== this.lastTick) {
      this.lastTick = tick; this.tick = tick; this.tickT = this.t;
      if (this.active) { this.ticks.unshift(this.t); this.ticks.length = Math.min(this.ticks.length, 6); }
    }

    // capa automática (música)
    const k = (n) => c.bands?.[n] ?? { hit: 0, env: 0 };
    const thr = p.get('fourier.umbral') ?? 0.25;
    this.bass = Math.max(0, k(1).env - 0.15);
    const minGap = this.safe ? 1 / 3 : 0.06;
    if (k(0).hit > thr && this.t - this.lastGlobal > minGap) { this.kick = k(0).hit; this.kickT = this.t; this.lastGlobal = this.t; }
    if (k(2).hit > thr) { this.snare = k(2).hit; this.snareN++; }
    this.hats = Math.max(this.hats * Math.exp(-dt * 10), k(4).hit > thr ? k(4).hit : 0);
    if (c.onBeat) this.chase++;
    if (c.onSection) this.blind = 1;
    this.snare *= Math.exp(-dt * 9); this.blind *= Math.exp(-dt * 1.6);
    this.flashDur = p.get('estrobo.duracion') / 1000;
  }

  /** Envolvente de un destello que ocurrió hace `age` segundos. */
  env(age) { return age < 0 ? 0 : Math.exp(-age / this.flashDur); }

  /** Color del pad según Y (y, para pares / arcoíris, la posición u y el tick). */
  padColor(u, v, tick, out) {
    const y = this.y, hs = this.secHue;
    if (y < 0.15) return out.setRGB(1, 0.97, 0.92);
    if (y < 0.4) return out.setHSL(hs, 0.95, 0.55);
    if (y < 0.65) return out.setHSL((hs + ((Math.floor(u * 8) + tick) % 2) * 0.5) % 1, 0.95, 0.55);
    if (y < 0.85) return out.setHSL((u * 0.85 + v * 0.15) % 1, 1, 0.55);
    return out.setHSL((u * 0.6 + tick * 0.13) % 1, 1, 0.55);
  }

  /** Color de la luz en (u, v). Escribe en `out` (THREE.Color) y lo devuelve. */
  sample(u, v, out = new THREE.Color()) {
    const bri = this.params.get('estrobo.brillo'), fondo = this.params.get('estrobo.fondo');
    out.setHSL(this.secHue, 0.9, 0.5).multiplyScalar(fondo * (0.5 + this.bass * 2));   // fondo con el bajo
    if (this.active) this.padLayer(u, v, _a);
    else if (this.params.get('estrobo.auto')) this.autoLayer(u, v, _a);
    else _a.setRGB(0, 0, 0);
    return out.add(_a).multiplyScalar(bri);
  }

  padLayer(u, v, out) {
    const N = 8, tick = this.tick, age = this.t - this.tickT;
    const e = this.env(age);
    const col = this.padColor(u, v, tick, _b);
    let g = 0;
    switch (this.program) {
      case 'estrobo': case 'tartamudeo': g = e; break;
      case 'persecución': {
        const dir = Math.floor(tick / N) % 2 ? -1 : 1, pos = ((((tick % N) + N) % N) + 0.5) / N;
        const p = dir > 0 ? pos : 1 - pos; g = Math.max(0, 1 - Math.abs(u - p) * N * 1.2) * (0.35 + 0.65 * e) * 1.2; break;
      }
      case 'aleatorio': g = hash(tick * 13.1 + Math.floor(u * 16) * 3.7 + Math.floor(v * 8) * 1.3) > 0.55 ? e : 0; break;
      case 'espejo': {
        const pos = ((((tick % N) + N) % N) + 0.5) / N, d = Math.abs(u - 0.5) * 2;
        g = Math.max(0, 1 - Math.abs(d - pos) * N) * (0.35 + 0.65 * e) * 1.2; break;
      }
      case 'ola': {
        const w = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 1.5 + v * 0.3 - this.beatPos * this.rate * 0.25));
        g = Math.pow(w, 4); break;
      }
      case 'filtro': {
        // X elige la banda; la luz sube hasta donde llega su envolvente y destella con sus golpes
        g = 0; break;   // se resuelve en filterLayer (necesita las bandas)
      }
      case 'eco': {
        const fb = 0.62;
        for (let j = 0; j < this.ticks.length; j++) {
          const a = this.t - this.ticks[j], p = (((tick - j) % N + N) % N + 0.5) / N - j * 0.06;
          g += Math.pow(fb, j) * this.env(a - j * 0.0) * Math.max(0, 1 - Math.abs(u - p) * N);
        }
        g = Math.min(1.5, g); break;
      }
      default: g = e;
    }
    if (this.program === 'filtro') return this.filterLayer(u, v, out, col);
    return out.copy(col).multiplyScalar(g * 1.6);
  }

  filterLayer(u, v, out, col) {
    const b = Math.min(4, Math.floor(this.x * 5)), band = this._bands?.[b];
    const envl = band?.env ?? 0, hit = band?.hit ?? 0;
    const fill = v <= envl * 1.1 ? 1 : 0;
    return out.copy(col).multiplyScalar(fill * (0.3 + 0.7 * envl) + hit * 0.9);
  }

  autoLayer(u, v, out) {
    out.setRGB(0, 0, 0);
    // bombo: destello blanco de todo
    const ke = this.env(this.t - this.kickT) * this.kick;
    out.r += ke; out.g += ke * 0.97; out.b += ke * 0.92;
    // caja: damero de color
    const chk = (Math.floor(u * 8) + Math.floor(v * 4) + this.snareN) % 2 === 0 ? this.snare : 0;
    _b.setHSL((this.secHue + 0.5) % 1, 1, 0.55).multiplyScalar(chk * 1.2); out.add(_b);
    // platillos: chispas
    if (this.hats > 0.05 && hash(Math.floor(this.t * 40) * 0.71 + Math.floor(u * 16) * 3.3 + Math.floor(v * 8) * 7.7) > 0.88) { _b.setHSL((this.secHue + 0.15) % 1, 0.4, 0.8).multiplyScalar(this.hats * 1.4); out.add(_b); }
    // beat: paso de persecución (tenue)
    const pos = ((this.chase % 8) + 0.5) / 8;
    _b.setHSL(this.secHue, 0.95, 0.5).multiplyScalar(Math.max(0, 1 - Math.abs(u - pos) * 8) * 0.45); out.add(_b);
    // sección: cegadora
    if (this.blind > 0.01) { out.r += this.blind; out.g += this.blind * 0.85; out.b += this.blind * 0.6; }
    return out;
  }

  /** Bandas para el programa filtro (lo llama quien tenga las cues). */
  setBands(bands) { this._bands = bands; }

  /** Pose de una cabeza móvil i de n (pan, tilt en radianes) según el programa. */
  headPose(i, n, out = { pan: 0, tilt: 0.5 }) {
    const k = i - (n - 1) / 2, b = this.beatPos, tick = this.tick;
    const prog = this.active ? this.program : 'auto';
    if (prog === 'estrobo' || prog === 'tartamudeo') { out.pan = k * 0.12; out.tilt = 0.35; }
    else if (prog === 'persecución' || prog === 'ola') { out.pan = Math.sin(b * Math.PI * 0.5 + i * 0.6) * 0.9; out.tilt = 0.5 + Math.sin(b * Math.PI * 0.25 + i) * 0.25; }
    else if (prog === 'aleatorio') { out.pan = (hash(tick * 3.1 + i) - 0.5) * 1.8; out.tilt = 0.25 + hash(tick * 1.7 + i + 9) * 0.6; }
    else if (prog === 'espejo') { const o = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(b * Math.PI * 0.5)); out.pan = Math.sign(k || 1) * o * (Math.abs(k) / ((n - 1) / 2) * 0.8 + 0.2); out.tilt = 0.45; }
    else { out.pan = Math.sin(b * Math.PI * 0.25 + i * 0.8) * 0.7; out.tilt = 0.45 + Math.sin(b * Math.PI * 0.125 + i * 1.3) * 0.2; }
    return out;
  }
}
