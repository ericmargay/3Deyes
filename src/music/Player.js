/**
 * Reproductor y fuente de "cues" para las escenas de Live Fourier Cinestesia.
 *
 *  archivo   decodifica el tema, lo analiza entero en un worker y lo reproduce
 *            con el reloj del AudioContext: la posición visual sale del mismo
 *            reloj que el sonido (sin deriva), más una compensación de
 *            latencia ajustable (proyectores, salida de audio).
 *  en vivo   micrófono / línea (Ableton por BlackHole) → analizador en vivo
 *  pestaña   audio de otra pestaña (YouTube, YouTube Music, Spotify web…) →
 *            analizador en vivo. Chrome: elegir la pestaña y marcar "compartir audio".
 *
 * Expone `cues` (MusicCues / LiveCues / IdleCues) con la misma interfaz.
 * Publica además las fuentes audio:level/bass/mid/high/beat del bus (learn).
 */
import { MusicCues, IdleCues } from './Cues.js';
import { analyze } from './analysis.js';
import { LiveAnalyzer, LiveCues } from './Live.js';
import { TriggerBank, STAGE_TRIGGERS } from './Trigger.js';

let sharedCtx = null;
export function audioContext() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  return sharedCtx;
}

export const SOURCES = ['archivo', 'en vivo (mic / línea)', 'pestaña (YouTube, Spotify…)'];
const DB = '3deyes', STORE = 'archivos', KEY = 'musica';

function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export class MusicPlayer extends EventTarget {
  constructor(params, log = console.log, app = null) {
    super();
    this.params = params; this.log = log; this.app = app;
    this.idle = new IdleCues(100);
    this.cues = this.idle;
    this.track = null;          // { name, buffer, analysis, duration }
    this.playing = false; this.offset = 0; this.startedAt = 0; this.source = null;
    this.progress = 0; this.progressMsg = ''; this.analyzing = false;
    this.live = null;           // LiveAnalyzer activo
    this.liveCues = null;
    this.posTimer = 0;
    this.worker = null; this.nextId = 1; this.pending = new Map();

    const p = params;
    p.define('musica.fuente', { type: 'option', options: SOURCES, default: 'archivo', label: 'fuente' });
    p.define('musica.cargar', { type: 'trigger', label: 'cargar archivo de música…' });
    p.define('musica.play', { default: false, label: 'reproducir' });
    p.define('musica.posicion', { min: 0, max: 1, default: 0, step: 0.0001, label: 'posición' });
    p.define('musica.volumen', { min: 0, max: 1, default: 0.9, step: 0.01, label: 'volumen' });
    p.define('musica.loop', { default: true, label: 'repetir' });
    p.define('musica.latencia', { min: -200, max: 500, default: 0, step: 1, label: 'latencia (ms): + adelanta lo visual' });
    p.define('musica.bpmVivo', { min: 40, max: 200, default: 100, step: 0.5, label: 'bpm sin música' });
    p.define('musica.tap', { type: 'trigger', label: 'tap (beat sin música)' });
    p.onChange((id, v, src) => {
      if (id === 'musica.play') { if (v) this.play(); else this.pause(); }
      else if (id === 'musica.posicion' && src !== 'player' && this.track) this.seek(v * this.track.duration);
      else if (id === 'musica.volumen' && this.gain) this.gain.gain.value = v;
      else if (id === 'musica.cargar') this.pickFile();
      else if (id === 'musica.fuente') this.setSource(v);
      else if (id === 'musica.bpmVivo') this.idle.setBpm(v);
      else if (id === 'musica.tap') { if (this.cues === this.idle) this.idle.tap(); }
    });
    this.idle.setBpm(p.get('musica.bpmVivo'));
    this.triggers = new TriggerBank(p, STAGE_TRIGGERS);
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && /audio|mp3|wav|flac|m4a|ogg|aac/i.test(f.type + f.name)) this.loadFile(f); });
  }

  get ctx() { return audioContext(); }
  ensureGraph() {
    if (this.gain) return;
    this.gain = this.ctx.createGain(); this.gain.gain.value = this.params.get('musica.volumen');
    this.gain.connect(this.ctx.destination);
  }

  // ---------- carga ----------
  pickFile() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac';
    input.onchange = () => { if (input.files[0]) this.loadFile(input.files[0]); };
    input.click();
  }
  async loadFile(file) { this.log(`música: ${file.name}`); return this.loadBuffer(await file.arrayBuffer(), file.name, true); }
  async loadUrl(url, name = url.split('/').pop()) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return this.loadBuffer(await r.arrayBuffer(), decodeURIComponent(name), false); }
    catch (e) { this.log(`música: no se pudo cargar ${name} (${e.message})`); return false; }
  }
  async restoreLast() {
    try {
      const db = await idb();
      const rec = await new Promise((res) => { const tx = db.transaction(STORE, 'readonly'); const q = tx.objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
      if (rec?.buffer) { await this.loadBuffer(rec.buffer, rec.name, false); return true; }
    } catch (_) { /* */ }
    return false;
  }
  async remember(buffer, name) {
    try { const db = await idb(); await new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put({ buffer, name }, KEY); tx.oncomplete = res; tx.onerror = res; }); } catch (_) { /* */ }
  }

  async loadBuffer(arrayBuffer, name, remember) {
    this.ensureGraph();
    this.pause();
    this.analyzing = true; this.progress = 0; this.progressMsg = 'decodificando';
    this.emit('progress');
    let audio;
    try { audio = await this.ctx.decodeAudioData(arrayBuffer.slice(0)); }
    catch (e) { this.analyzing = false; this.log(`música: formato no soportado (${e.message})`); this.emit('progress'); return false; }
    // mezcla a mono
    const n = audio.length, mono = new Float32Array(n);
    for (let c = 0; c < audio.numberOfChannels; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i]; }
    if (audio.numberOfChannels > 1) for (let i = 0; i < n; i++) mono[i] /= audio.numberOfChannels;
    this.progressMsg = 'analizando';
    const t0 = performance.now();
    let A;
    try { A = await this.analyzeAsync(mono, audio.sampleRate); }
    catch (e) { this.analyzing = false; this.log(`música: análisis falló (${e.message})`); return false; }
    this.analyzing = false; this.progress = 1;
    this.track = { name, buffer: audio, analysis: A, duration: audio.duration };
    this.cues = new MusicCues(A);
    this.offset = 0;
    this.log(`${name}: ${A.bpm} bpm · ${A.beats.length} beats · ${A.sections.length} secciones · ${A.notes.length} notas (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    if (remember) this.remember(arrayBuffer, name);
    this.params.set('musica.fuente', 'archivo', 'player');
    this.emit('loaded');
    if (this.params.get('musica.play')) this.play();
    return true;
  }

  analyzeAsync(mono, sr) {
    return new Promise((resolve, reject) => {
      if (this.worker === false) { setTimeout(() => { try { resolve(analyze(mono, sr, (p, m) => { this.progress = p; this.progressMsg = m; })); } catch (e) { reject(e); } }, 0); return; }
      if (!this.worker) {
        try {
          this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
          this.worker.onmessage = (e) => {
            const d = e.data, p = this.pending.get(d.id); if (!p) return;
            if (d.progress !== undefined) { this.progress = d.progress; this.progressMsg = d.msg; this.emit('progress'); return; }
            this.pending.delete(d.id);
            if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
          };
          this.worker.onerror = (e) => { console.warn('[música] worker falló, analizando en el hilo principal', e.message); this.worker = false; for (const [, p] of this.pending) p.fallback(); this.pending.clear(); };
        } catch (_) { this.worker = false; return this.analyzeAsync(mono, sr).then(resolve, reject); }
      }
      const id = this.nextId++;
      const copy = mono.slice(0);
      this.pending.set(id, { resolve, reject, fallback: () => { try { resolve(analyze(copy, sr, () => {})); } catch (e) { reject(e); } } });
      this.worker.postMessage({ id, pcm: mono, sr }, [mono.buffer]);
    });
  }

  // ---------- transporte ----------
  get duration() { return this.track?.duration ?? 0; }
  get name() { return this.track?.name ?? ''; }
  time() {
    if (!this.track) return 0;
    const t = this.playing ? this.offset + (this.ctx.currentTime - this.startedAt) : this.offset;
    return Math.max(0, Math.min(this.track.duration, t));
  }
  /** Tiempo "visual": el que oye el público, compensando la latencia de salida. */
  /**
   * Forma de onda: las últimas n muestras hasta el instante que se ve (L y R;
   * en vivo es mono y R = L). Devuelve la frecuencia de muestreo, o 0 si no hay audio.
   */
  waveform(n, outL, outR = outL) {
    if (this.live) {
      const L = this.live, ring = L.ring, N = ring.length;
      for (let i = 0; i < n; i++) outL[i] = outR[i] = ring[(L.w - n + i + N) % N];
      return L.sr;
    }
    const b = this.track?.buffer; if (!b) return 0;
    const sr = b.sampleRate, end = Math.floor((this.playing ? this.visualTime() : this.offset) * sr);
    const cl = b.getChannelData(0), cr = b.numberOfChannels > 1 ? b.getChannelData(1) : cl;
    for (let i = 0; i < n; i++) { const j = end - n + i; const ok = j >= 0 && j < cl.length; outL[i] = ok ? cl[j] : 0; outR[i] = ok ? cr[j] : 0; }
    return sr;
  }

  visualTime() { return this.time() - (this.ctx.outputLatency || this.ctx.baseLatency || 0) + this.params.get('musica.latencia') / 1000; }

  play() {
    if (!this.track) { this.params.set('musica.play', false, 'player'); return; }
    if (this.playing) return;
    this.ensureGraph();
    this.ctx.resume();
    if (this.offset >= this.track.duration - 0.05) this.offset = 0;
    const s = this.ctx.createBufferSource(); s.buffer = this.track.buffer; s.connect(this.gain);
    s.start(0, this.offset);
    s.onended = () => { if (this.source === s && this.playing) { this.playing = false; this.offset = this.track.duration; if (this.params.get('musica.loop')) { this.offset = 0; this.play(); } else this.params.set('musica.play', false, 'player'); } };
    this.source = s; this.startedAt = this.ctx.currentTime; this.playing = true;
    this.params.set('musica.play', true, 'player');
    this.emit('state');
  }
  pause() {
    if (!this.playing) { this.params.set('musica.play', false, 'player'); return; }
    this.offset = this.time(); this.playing = false;
    const s = this.source; this.source = null; try { s.onended = null; s.stop(); } catch (_) { /* */ }
    this.params.set('musica.play', false, 'player');
    this.emit('state');
  }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  seek(t) {
    if (!this.track) return;
    const was = this.playing; if (was) this.pause();
    this.offset = Math.max(0, Math.min(this.track.duration, t));
    if (this.cues?.reset) this.cues.reset(this.offset);
    if (was) this.play(); else this.emit('state');
  }

  // ---------- en vivo ----------
  async setSource(src) {
    if (src === 'archivo') { this.stopLive(); this.cues = this.track ? new MusicCues(this.track.analysis) : this.idle; if (this.track) this.cues.reset(this.time()); return; }
    this.pause();
    try {
      this.ensureGraph();
      await this.ctx.resume();
      let stream;
      if (src === SOURCES[1]) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (!stream.getAudioTracks().length) throw new Error('la pestaña no compartió audio: elegir una pestaña de Chrome y marcar "compartir audio de la pestaña"');
      }
      this.stopLive();
      this.live = new LiveAnalyzer(this.ctx, stream, src === SOURCES[2]);
      this.liveCues = new LiveCues(this.live);
      if (this.app?.midi?.clock) this.liveCues.setClock(this.app.midi.clock);
      this.cues = this.liveCues;
      stream.getAudioTracks()[0].onended = () => { if (this.live) { this.log('fuente en vivo terminó'); this.params.set('musica.fuente', 'archivo'); } };
      this.log(src === SOURCES[1] ? 'en vivo: micrófono / línea' : 'en vivo: audio de la pestaña');
    } catch (e) { this.log(`en vivo: ${e.message}`); this.params.set('musica.fuente', 'archivo', 'player'); }
  }
  stopLive() { if (this.live) { this.live.dispose(); this.live = null; this.liveCues = null; } }

  // ---------- por cuadro ----------
  update(dt) {
    const p = this.params;
    if (this.live) {
      this.live.update();
      this.cues.setTime(this.ctx.currentTime, dt);
    } else if (this.track && this.cues !== this.idle) {
      const t = this.playing ? this.visualTime() : this.offset;
      this.cues.setTime(t, this.playing ? dt : 0);
      this.posTimer += dt;
      if (this.playing && this.posTimer > 0.25) { this.posTimer = 0; p.set('musica.posicion', t / this.track.duration, 'player'); }
    } else {
      this.cues.setTime(0, dt);
    }
    const c = this.cues;
    this.triggers.update(c, dt);
    // fuentes del bus (compatibles con las asignaciones "learn" existentes)
    p.feed('audio:level', c.loud ?? 0, 'music'); p.feed('audio:bass', c.bands[0].env, 'music'); p.feed('audio:mid', c.bands[2].env, 'music'); p.feed('audio:high', c.bands[4].env, 'music');
    p.feed('audio:beat', c.onBeat ? 1 : 0, 'music');
    if (this.app) {
      if (c.onBeat) this.app.emit('beat', { downbeat: c.onDownbeat, bar: c.bar, strength: c.beatStrength });
      if (c.onSection) this.app.emit('section', { index: c.sectionIndex, type: c.section?.type });
      for (let i = 0; i < c.bands.length; i++) if (c.bands[i].hit > 0) this.app.emit('hit', { band: c.bands[i].key, strength: c.bands[i].hit });
    }
  }

  emit(type) { this.dispatchEvent(new CustomEvent(type)); }
}
