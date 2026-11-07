/**
 * Panel de música (abajo al centro): fuente, transporte y mapa del tema.
 *
 *  ♫ archivo · pestaña (YouTube, Spotify…) · mic / línea · link de YouTube
 *  ▶ / ⏸, nombre, tiempo, bpm, sección
 *  barra: secciones coloreadas (misma letra = mismo color), downbeats, cursor;
 *  clic para saltar. Mientras analiza muestra el progreso.
 *
 * Teclas: A muestra / oculta · espacio o K reproduce / pausa · J / L ±5 s
 */
import { SOURCES } from './Player.js';
import { sectionColor } from '../scenes/music/MusicScene.js';

export class MusicPanel {
  constructor(player, params, log = console.log) {
    this.player = player; this.params = params; this.log = log;
    this.el = document.getElementById('musica');
    if (!this.el) return;
    this.$ = (id) => document.getElementById(id);
    this.canvas = this.$('muBar'); this.ctx = this.canvas.getContext('2d');
    this.$('muFile').onclick = () => player.pickFile();
    this.$('muTab').onclick = () => params.set('musica.fuente', SOURCES[2]);
    this.$('muMic').onclick = () => params.set('musica.fuente', SOURCES[1]);
    this.$('muPlay').onclick = () => player.toggle();
    this.$('muYtGo').onclick = () => this.youtube();
    this.$('muYt').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.youtube(); e.stopPropagation(); });
    this.$('muClose').onclick = () => this.toggle(false);
    this.canvas.addEventListener('pointerdown', (e) => { const r = this.canvas.getBoundingClientRect(); if (player.track) player.seek(((e.clientX - r.left) / r.width) * player.duration); });
    player.addEventListener('loaded', () => this.refresh());
    player.addEventListener('state', () => this.refresh());
    player.addEventListener('progress', () => this.refresh());
    params.onChange((id) => { if (id === 'musica.fuente') this.refresh(); });
    this.refresh();
  }

  toggle(show = this.el.classList.contains('hidden')) { this.el.classList.toggle('hidden', !show); }
  get visible() { return !this.el.classList.contains('hidden'); }

  youtube() {
    const url = this.$('muYt').value.trim();
    if (!url) return;
    // el navegador no puede bajar el audio de YouTube: se abre el video en otra pestaña y se captura su audio
    window.open(url, '_blank');
    this.$('muStatus').textContent = 'cuando el video esté sonando, volvé acá y apretá "pestaña": elegí esa pestaña y marcá "compartir audio".';
    this.$('muTab').classList.add('pulse');
  }

  refresh() {
    const p = this.player, src = this.params.get('musica.fuente');
    this.$('muPlay').textContent = p.playing ? '⏸' : '▶';
    this.$('muName').textContent = p.analyzing ? `${p.progressMsg}… ${Math.round(p.progress * 100)} %` : src !== 'archivo' ? src : p.track ? p.name : 'sin tema: arrastrá un archivo o elegí una fuente';
    const A = p.track?.analysis;
    this.$('muBpm').textContent = src !== 'archivo' ? (p.cues.bpm ? `${p.cues.bpm.toFixed(1)} bpm (en vivo)` : 'escuchando…') : A ? `${A.bpm} bpm · ${A.sections.length} secciones · ${A.notes.length} notas` : '';
    this.$('muTab').classList.remove('pulse');
  }

  /** Monitor de triggers (kick, bajo, caja, hats…): barras a la derecha, para ver y afinar la sincronía. */
  drawTriggers(c, W, H) {
    const bank = this.player.triggers; if (!bank) return;
    const names = [...bank.triggers.keys()], w = 7, gap = 3, x0 = W - names.length * (w + gap) - 4;
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x0 - 4, 0, names.length * (w + gap) + 8, H);
    names.forEach((n, i) => {
      const v = bank.get(n), x = x0 + i * (w + gap);
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x, 2, w, H - 4);
      c.fillStyle = bank.fired(n) ? '#fff' : '#ff4fa3'; c.fillRect(x, 2 + (H - 4) * (1 - v), w, (H - 4) * v);
      c.fillStyle = '#aaa'; c.font = '7px ui-monospace, monospace'; c.fillText(n.slice(0, 4), x - 1, H - 1);
    });
  }

  /** Dibuja la barra (llamar por cuadro: es barato). */
  draw() {
    if (!this.el || !this.visible) return;
    const p = this.player, c = this.ctx, cv = this.canvas;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * 2 || cv.height !== H * 2) { cv.width = W * 2; cv.height = H * 2; }
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, W, H);
    const A = p.track?.analysis, cues = p.cues;
    if (p.analyzing) { c.fillStyle = '#ff4fa3'; c.fillRect(0, H / 2 - 2, W * p.progress, 4); return; }
    if (!A) {
      c.fillStyle = '#333'; c.fillRect(0, H / 2 - 1, W, 2);
      if (cues?.live) { const x = (cues.beatPhase || 0) * W; c.fillStyle = cues.onBeat ? '#fff' : '#ff4fa3'; c.fillRect(x - 2, 0, 4, H); }
      this.drawTriggers(c, W, H);
      return;
    }
    const D = A.duration, X = (t) => (t / D) * W;
    for (const s of A.sections) { const col = sectionColor(s.type); c.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.55)`; c.fillRect(X(s.t0), 4, X(s.t1) - X(s.t0), H - 8); }
    c.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < A.beats.length; i++) if (A.downbeat[i]) c.fillRect(X(A.beats[i]), H - 7, 1, 3);
    // onsets fuertes del sub como puntos (kicks)
    c.fillStyle = 'rgba(255,255,255,0.5)';
    for (const o of A.bands[0].onsets) if (o.s > 0.75) c.fillRect(X(o.t), 2, 1, 2);
    const t = p.cues?.t ?? 0;
    c.fillStyle = '#fff'; c.fillRect(X(t) - 1, 0, 2, H);
    this.drawTriggers(c, W, H);
    const tt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const sec = cues.section; const letters = 'ABCDEFGHIJ';
    this.$('muTime').textContent = `${tt(t)} / ${tt(D)}   compás ${cues.bar + 1}.${cues.beatInBar + 1}${sec ? `   sección ${letters[sec.type] || sec.type}` : ''}`;
  }
}
