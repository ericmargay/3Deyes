import * as THREE from 'three';
import { BAND_HUES, sectionHue } from '../scenes/music/MusicScene.js';

/**
 * Rig de luces: los artefactos del set (reales o virtuales) y la lógica que
 * los mueve con la música. El mismo rig alimenta la escena 3D "Escenario" y
 * la salida Art-Net a los artefactos físicos (ESP32 + LEDs direccionables,
 * cabezas móviles por un nodo DMX).
 *
 * Tipos:
 *   tubo / barra   N píxeles RGB direccionables (3 canales por píxel)
 *   area           barra de luz de área (bajo los techos): r, g, b, dimmer (4 canales)
 *   cabeza         cabeza móvil: pan, tilt, dimmer, r, g, b, estrobo (7 canales)
 *   wash           r, g, b, dimmer (4 canales)
 *
 * Patch: cada artefacto tiene ip (del ESP32 o del nodo), universo y canal
 * inicial (1..512). Unidades del layout: metros; el muro del mural está en
 * z ≈ -1, los pabellones a los lados (|x| ≈ 7), el público en +z.
 *
 * Lógica: sale de los triggers de audio (grupo `trigger`: kick, bajo, caja,
 * hats, beat, compás, cielo, sección), cada uno con su banda, umbral, ataque
 * y liberación, como el "Audio Trigger" del video de referencia:
 *   áreas     bajo (envolvente) + kick; con la caja viran a blanco
 *   tubos     cometa por cada golpe grave que viene (llega justo en el golpe),
 *             destello con el kick, anillo en el beat, chispas de hats
 *   barras    VU por banda + kick
 *   cabezas   pose nueva en el compás (cada 1 / 2 / 4 según la energía), barrido
 *             en secciones tranquilas, estrobo con hats en las intensas
 *   washes    bajo + kick
 *   cielo     el trigger `cielo` (kick fuerte) enciende el mundo entero
 */
export const RIG = {
  screen: { w: 10, h: 5.6, bottom: 0.9, z: -1 },
  fixtures: [
    // barras de área bajo los techos de los pabellones (2 por lado)
    ...[-1, 1].flatMap((side) => [0, 1].map((i) => ({ id: `area${side < 0 ? 'I' : 'D'}${i + 1}`, type: 'area', pos: [side * 7.1, 3.1, 2.6 + i * 2.9], length: 2.6, dir: [1, 0, 0], ip: '2.0.0.50', universe: 23, channel: 17 + (side < 0 ? 0 : 2) * 4 + i * 4 }))),
    // tubos verticales en las columnas internas de cada pabellón (2 por lado) y a los lados del mural
    ...[-1, 1].flatMap((side) => [0, 1].map((i) => ({ id: `tubo${side < 0 ? 'I' : 'D'}${i + 1}`, type: 'tubo', pixels: 60, length: 1.5, pos: [side * 4.65, 0.35, 1.3 + i * 5.4], dir: [0, 1, 0], ip: `2.0.0.${10 + i * 2 + (side < 0 ? 0 : 1)}`, universe: i * 2 + (side < 0 ? 0 : 1), channel: 1 }))),
    ...[-1, 1].map((side) => ({ id: `tuboM${side < 0 ? 'I' : 'D'}`, type: 'tubo', pixels: 60, length: 1.5, pos: [side * 5.9, 1.1, -0.55], dir: [0, 1, 0], ip: `2.0.0.${14 + (side < 0 ? 0 : 1)}`, universe: 4 + (side < 0 ? 0 : 1), channel: 1 })),
    // tubos horizontales sobre el mural
    ...[0, 1, 2, 3].map((i) => ({ id: `tuboA${i + 1}`, type: 'tubo', pixels: 60, length: 1.5, pos: [-4.1 + i * 2.3, 6.85, -0.5], dir: [1, 0, 0], ip: `2.0.0.${20 + i}`, universe: 10 + i, channel: 1 })),
    // barras del piso a los bordes del pasillo
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `barra${i + 1}`, type: 'barra', pixels: 60, length: 1.0, pos: [(i % 2 ? 1 : -1) * 3.1, 0.04, 1.5 + Math.floor(i / 2) * 4], dir: [0, 0, 1], ip: `2.0.0.${30 + i}`, universe: 14 + i, channel: 1 })),
    // cabezas móviles en el truss, delante del mural
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `cabeza${i + 1}`, type: 'cabeza', pos: [-6 + i * 2.4, 7.25, 0.4], ip: '2.0.0.50', universe: 22, channel: 1 + i * 7 })),
    // washes en el piso, iluminando los pabellones desde abajo
    ...[-1, 1].map((side) => ({ id: `wash${side < 0 ? 'I' : 'D'}`, type: 'wash', pos: [side * 7.1, 0.12, 7.9], aim: [side * 7.1, 3.2, 4], ip: '2.0.0.50', universe: 23, channel: 1 + (side < 0 ? 0 : 1) * 4 })),
  ],
};

const _c = new THREE.Color(), _w = new THREE.Color();
const hash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export class LightRig {
  constructor(params, def = RIG) {
    this.params = params; this.def = def;
    this.fixtures = def.fixtures.map((f, i) => ({
      ...f, index: i,
      px: f.pixels ? new Float32Array(f.pixels * 3) : null,
      color: new THREE.Color(), dimmer: 0, pan: 0, tilt: 0.6, panT: 0, tiltT: 0.6, strobe: 0, pulse: 0, seed: hash(i + 1),
    }));
    this.heads = this.fixtures.filter((f) => f.type === 'cabeza');
    this.universes = new Map();
    this.t = 0; this.sectionColor = new THREE.Color(1, 0.2, 0.1); this.sky = 0; this.white = 0;
    const p = params, d = (id, o) => { if (!p.has(id)) p.define(id, o); };
    d('luces.master', { min: 0, max: 1, default: 0.85, step: 0.01, label: 'master (brillo general)' });
    d('luces.cometas', { min: 0, max: 2, default: 1, step: 0.01, label: 'cometas (golpes que vienen)' });
    d('luces.chispas', { min: 0, max: 2, default: 0.8, step: 0.01, label: 'chispas (hats)' });
    d('luces.cabezas', { type: 'option', options: ['auto', 'barrido', 'público', 'pantalla', 'cruzadas', 'quietas'], default: 'auto', label: 'cabezas móviles' });
    d('luces.estrobo', { min: 0, max: 1, default: 0.5, step: 0.01, label: 'estrobo con hats (secciones intensas)' });
    d('luces.ambiente', { min: 0, max: 0.5, default: 0.05, step: 0.005, label: 'luz de fondo de los tubos' });
    d('luces.monocromo', { min: 0, max: 1, default: 0.75, step: 0.01, label: 'monocromo (todo del color de la sección)' });
    d('luces.artnet', { default: false, label: 'enviar Art-Net (npm run artnet-bridge)' });
    d('luces.fps', { min: 10, max: 44, default: 40, step: 1, label: 'cuadros por segundo Art-Net' });
    d('luces.kaoss', { type: 'option', options: ['con el pad', 'siempre', 'nunca'], default: 'con el pad', label: 'pad Kaoss toma las luces (motor de estrobo)' });
    // layout normalizado (u izquierda→derecha, v abajo→arriba) para el motor Kaoss
    const xs = this.fixtures.map((f) => f.pos[0]), ys = this.fixtures.map((f) => f.pos[1] + (f.dir?.[1] ?? 0) * (f.length ?? 0));
    this.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...this.fixtures.map((f) => f.pos[1])), y1: Math.max(...ys) };
  }

  hue(h) { return (h + (this.params.get('fourier.tono') ?? 0)) % 1; }
  /** Color del artefacto: entre el color de banda y el de la sección según `monocromo`. */
  tone(bandHue, l = 0.55) { const mono = this.params.get('luces.monocromo'); return _c.setHSL(this.hue(bandHue), 0.85, l).lerp(this.sectionColor, mono).clone(); }

  /** Posición normalizada de un punto del layout para el motor Kaoss. */
  uv(x, y) { const B = this.bounds; return [(x - B.x0) / Math.max(1e-3, B.x1 - B.x0), (y - B.y0) / Math.max(1e-3, B.y1 - B.y0)]; }

  /** El motor Kaoss pisa a todos los artefactos (pad tocado o modo "siempre"). */
  applyKaoss(engine, master, dt) {
    const n = this.heads.length;
    for (const f of this.fixtures) {
      if (f.px) {
        const N = f.pixels, L = f.length ?? 1, d = f.dir ?? [1, 0, 0];
        for (let i = 0; i < N; i++) {
          const a = i / Math.max(1, N - 1), [u, v] = this.uv(f.pos[0] + d[0] * L * a, f.pos[1] + d[1] * L * a);
          engine.sample(u, v, _c);
          f.px[i * 3] = Math.min(1, _c.r * master); f.px[i * 3 + 1] = Math.min(1, _c.g * master); f.px[i * 3 + 2] = Math.min(1, _c.b * master);
        }
      } else {
        const [u, v] = this.uv(f.pos[0], f.pos[1]);
        engine.sample(u, v, _c);
        const I = Math.max(_c.r, _c.g, _c.b);
        f.color.copy(_c).multiplyScalar(1 / Math.max(I, 1e-3)); f.dimmer = Math.min(1, I * master);
        if (f.type === 'cabeza') {
          const k = this.heads.indexOf(f), pose = engine.headPose(k, n), g = 1 - Math.exp(-dt * 8);
          f.panT = pose.pan; f.tiltT = 0.35 + pose.tilt; f.pan += (f.panT - f.pan) * g; f.tilt += (f.tiltT - f.tilt) * g; f.strobe = 0;
        }
      }
    }
  }

  update(cues, dt, trig, lookahead, engine = null) {
    const p = this.params, c = cues, master = p.get('luces.master');
    this.t += dt;
    const sec = c.section?.type ?? 0, e = c.energy ?? 0.5;
    this.sectionColor.setHSL(this.hue(sectionHue(sec)), 0.9, 0.5);
    const T = (n) => trig?.get(n) ?? 0, fired = (n) => !!trig?.fired(n);
    const kick = T('kick'), bajo = T('bajo'), caja = T('caja'), hats = T('hats'), beat = T('beat'), compas = T('compas');
    this.sky = T('cielo'); this.white = caja;
    const amb = p.get('luces.ambiente'), com = p.get('luces.cometas'), chis = p.get('luces.chispas');
    const secCol = this.sectionColor;
    _w.set(1, 0.92, 0.85);

    for (const f of this.fixtures) {
      if (f.type === 'area') {
        const v = Math.min(1, bajo * 0.75 + kick * 0.9 + 0.04);
        f.color.copy(secCol).lerp(_w, caja * 0.9);
        f.dimmer = Math.min(1, (v + caja * 0.6) * master);
      } else if (f.type === 'tubo' || f.type === 'barra') {
        const N = f.pixels, px = f.px, vertical = f.dir[1] === 1;
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);   // 0 = origen (cerca de la pantalla o del piso)
          let r = secCol.r * amb, g = secCol.g * amb, b = secCol.b * amb;
          if (f.type === 'tubo') {
            // cometas: cada golpe grave que viene, de la punta lejana al origen
            for (const band of [0, 1]) for (const o of c.upcoming(band, lookahead)) {
              if (o.s < 0.35) continue;
              const pos = 1 - Math.max(0, 1 - (o.t - c.t) / lookahead) ** 1.4;
              const w = Math.max(0, 1 - Math.abs(u - pos) / 0.12);
              const k = w * w * o.s * com * (band === 0 ? 1 : 0.6);
              const col = this.tone(BAND_HUES[band], 0.6);
              r += col.r * k; g += col.g * k; b += col.b * k;
            }
            // destello del kick en todo el tubo (más fuerte en el origen)
            const fl = kick * (1.1 - u * 0.5) * 0.9;
            r += (secCol.r * 0.6 + 0.4) * fl; g += (secCol.g * 0.6 + 0.4) * fl; b += (secCol.b * 0.6 + 0.4) * fl;
            // caja: blanco
            r += caja * 0.5; g += caja * 0.5; b += caja * 0.5;
            // hats: chispas
            if (hats > 0.05) { const h = hash(i * 7.1 + Math.floor(c.t * 30) * 0.37 + f.index); if (h > 0.9) { const col = this.tone(BAND_HUES[4], 0.75); r += col.r * hats * chis; g += col.g * hats * chis; b += col.b * hats * chis; } }
            // anillo del beat que recorre el tubo
            const ring = Math.max(0, 1 - Math.abs(u - c.beatPhase * 1.1) / 0.07) * beat * (c.beatInBar === 0 ? 0.6 : 0.25);
            r += secCol.r * ring; g += secCol.g * ring; b += secCol.b * ring;
            void vertical;
          } else {
            const band = f.index % 5, env = c.bands[band].env, fill = Math.abs(u - 0.5) * 2 < env ? 1 : 0;
            const col = this.tone(BAND_HUES[band], 0.5);
            const k = fill * (0.3 + 0.7 * env) + c.bands[band].pulse * 0.5;
            r += col.r * k + kick * 0.45; g += col.g * k + kick * 0.45; b += col.b * k + kick * 0.45;
          }
          px[i * 3] = Math.min(1, r * master); px[i * 3 + 1] = Math.min(1, g * master); px[i * 3 + 2] = Math.min(1, b * master);
        }
      } else if (f.type === 'cabeza') {
        const mode = p.get('luces.cabezas'), n = this.heads.length, k = this.heads.indexOf(f);
        const every = e > 0.7 ? 1 : e > 0.4 ? 2 : 4;
        const auto = mode === 'auto' ? (e > 0.5 ? 'público' : e > 0.3 ? 'cruzadas' : 'barrido') : mode;
        if (fired('compas') && (c.bar % every === 0 || c.onSection) && auto !== 'quietas' && auto !== 'barrido') {
          if (auto === 'público') { f.panT = (hash(c.bar * 3.1 + k) - 0.5) * 1.5 + (k - (n - 1) / 2) * 0.22; f.tiltT = 0.85 + hash(c.bar * 1.7 + k + 5) * 0.6; }
          else if (auto === 'pantalla') { f.panT = (k - (n - 1) / 2) * 0.3 + (hash(c.bar + k) - 0.5) * 0.3; f.tiltT = -0.55 + hash(c.bar * 2.3 + k) * 0.35; }
          else if (auto === 'cruzadas') { f.panT = (k < n / 2 ? 1 : -1) * (0.5 + hash(c.bar * 2.9 + k) * 0.9); f.tiltT = 0.6 + hash(c.bar * 1.3 + k) * 0.7; }
          if (c.onSection) { f.panT += (hash(c.t + k) - 0.5) * 2; f.tiltT = 1.25; }
        }
        if (auto === 'barrido') { f.panT = Math.sin(this.t * 0.3 + k * 0.9) * 1.0; f.tiltT = 0.7 + Math.sin(this.t * 0.45 + k * 1.3) * 0.45; }
        const glide = c.onSection ? 10 : 3.2;
        f.pan += (f.panT - f.pan) * (1 - Math.exp(-dt * glide)); f.tilt += (f.tiltT - f.tilt) * (1 - Math.exp(-dt * glide));
        let dim = auto === 'quietas' ? 0.1 : (0.18 + 0.5 * e) * (0.45 + 0.55 * beat) + kick * 0.5;
        f.strobe = e > 0.75 && c.bands[4].hit > 0.7 && p.get('luces.estrobo') > 0 ? p.get('luces.estrobo') : f.strobe * Math.exp(-dt * 30);
        if (f.strobe > 0.05) dim *= Math.floor(this.t * 24) % 2 === 0 ? 1.7 : 0.08;
        f.dimmer = Math.min(1, dim * master);
        f.color.copy(this.tone(BAND_HUES[k % 5], 0.55)).lerp(_w, caja * 0.5);
      } else if (f.type === 'wash') {
        f.color.copy(secCol);
        f.dimmer = Math.min(1, (0.1 + 0.65 * bajo + kick * 0.6) * master);
      }
    }
    const km = p.get('luces.kaoss');
    if (engine && (km === 'siempre' || (km === 'con el pad' && engine.active))) this.applyKaoss(engine, master, dt);
    this.pack();
  }

  /** Empaqueta el estado en universos DMX (0..255). */
  pack() {
    for (const f of this.fixtures) {
      const key = `${f.ip}|${f.universe}`;
      let U = this.universes.get(key); if (!U) { U = new Uint8Array(512); this.universes.set(key, U); }
      let ch = f.channel - 1;
      const put = (v) => { if (ch < 512) U[ch] = Math.max(0, Math.min(255, Math.round(v * 255))); ch++; };
      if (f.px) { for (let i = 0; i < f.px.length; i++) put(f.px[i]); }
      else if (f.type === 'cabeza') { put(THREE.MathUtils.clamp(f.pan / (Math.PI * 1.5) + 0.5, 0, 1)); put(THREE.MathUtils.clamp(f.tilt / Math.PI + 0.5, 0, 1)); put(f.dimmer); put(f.color.r); put(f.color.g); put(f.color.b); put(f.strobe > 0.05 ? f.strobe : 0); }
      else { put(f.color.r); put(f.color.g); put(f.color.b); put(f.dimmer); }
    }
  }
}

/** Cliente del puente Art-Net (tools/artnet-bridge.js): manda los universos por WebSocket; el puente los pasa a UDP. */
export class ArtNetClient {
  constructor(params, log = console.log, url = null) {
    this.params = params; this.log = log;
    this.url = url || new URLSearchParams(location.search).get('artnet') || 'ws://localhost:8081';
    this.ws = null; this.timer = null; this.acc = 0; this.last = new Map();
    params.onChange((id, v) => { if (id === 'luces.artnet') { if (v) this.open(); else this.close(); } });
    if (params.get('luces.artnet')) this.open();
  }
  open() {
    if (this.ws) return;
    try { this.ws = new WebSocket(this.url); } catch (e) { this.log(`Art-Net: ${e.message}`); return; }
    this.ws.onopen = () => this.log(`Art-Net: puente conectado (${this.url})`);
    this.ws.onclose = () => { this.ws = null; if (this.params.get('luces.artnet')) { clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), 2000); } };
    this.ws.onerror = () => {};
  }
  close() { clearTimeout(this.timer); this.ws?.close(); this.ws = null; }
  send(rig, dt) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.acc += dt; if (this.acc < 1 / this.params.get('luces.fps')) return; this.acc = 0;
    const frames = [];
    for (const [key, U] of rig.universes) {
      const [ip, universe] = key.split('|');
      let s = ''; for (let i = 0; i < 512; i++) s += String.fromCharCode(U[i]);
      const b64 = btoa(s);
      if (this.last.get(key) === b64) continue;
      this.last.set(key, b64);
      frames.push({ ip, universe: Number(universe), data: b64 });
    }
    if (frames.length) this.ws.send(JSON.stringify({ artnet: frames }));
  }
}
