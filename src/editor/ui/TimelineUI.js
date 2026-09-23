/**
 * Línea de tiempo: lista de pistas + canvas con regla, grilla de beats,
 * keyframes (◆), cues (▼) y cabezal. Arrastrar para desplazar el tiempo o
 * mover keyframes; doble clic en una pista para agregar un keyframe.
 */
const ROW = 22, HEAD = 24, CUES = 20, LEFT = 8;

export class TimelineUI {
  constructor(els, timeline, ctx) {
    this.els = els; // { tracks, canvas, wrap, time, play, dur, bpm, loop, snap, auto, rec, zoom, addTrack, addCue, start, stop }
    this.tl = timeline;
    this.ctx = ctx; // { onSelectKey(track,key), onSelectCue(cue), onChanged(), recording(), toggleRecording(), trackOptions(), defaultCueAction() }
    this.pxPerSec = 20;
    this.scrollX = 0;
    this.selKey = null; this.selCue = null; this.selTrack = null;
    this.drag = null;
    this.canvas = els.canvas; this.g = this.canvas.getContext('2d');
    this.bind();
  }

  clip() { return this.tl.clip; }

  bind() {
    const e = this.els, tl = this.tl;
    e.play.onclick = () => { tl.toggle(); this.refresh(); };
    e.start.onclick = () => tl.seek(0);
    e.stop.onclick = () => { tl.stop(); this.refresh(); };
    e.dur.onchange = () => { this.clip().duration = Math.max(1, Number(e.dur.value)); this.changed(); };
    e.bpm.onchange = () => { this.clip().bpm = Math.max(20, Number(e.bpm.value)); this.changed(); };
    e.loop.onchange = () => { this.clip().loop = e.loop.checked; this.changed(); };
    e.auto.onchange = () => { this.clip().autoplay = e.auto.checked; this.changed(); };
    e.rec.onclick = () => { this.ctx.toggleRecording(); this.refresh(); };
    e.zoom.oninput = () => { this.pxPerSec = Number(e.zoom.value); this.draw(); };
    e.addTrack.onchange = () => { const t = e.addTrack.value; e.addTrack.value = ''; if (!t) return; const v = tl.readTarget(t); tl.setKey(t, v ?? 0); this.changed(); };
    e.addCue.onclick = () => { this.clip().cues.push({ t: tl.time, action: this.ctx.defaultCueAction() }); this.changed(); };
    const c = this.canvas;
    c.addEventListener('pointerdown', (ev) => this.onDown(ev));
    c.addEventListener('pointermove', (ev) => this.onMove(ev));
    c.addEventListener('pointerup', (ev) => this.onUp(ev));
    c.addEventListener('dblclick', (ev) => this.onDbl(ev));
    c.addEventListener('contextmenu', (ev) => { ev.preventDefault(); const hit = this.hit(ev); if (hit?.key) { hit.track.keys.splice(hit.track.keys.indexOf(hit.key), 1); this.selKey = null; this.changed(); } if (hit?.cue) { const cs = this.clip().cues; cs.splice(cs.indexOf(hit.cue), 1); this.changed(); } });
    c.addEventListener('wheel', (ev) => { if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) { this.scrollX = Math.max(0, this.scrollX + (ev.deltaX || ev.deltaY)); this.draw(); ev.preventDefault(); } }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(this.els.wrap);
  }

  resize() {
    const r = this.els.wrap.getBoundingClientRect();
    this.canvas.width = Math.max(10, Math.floor(r.width)); this.canvas.height = Math.max(10, Math.floor(r.height));
    this.draw();
  }

  changed() { this.ctx.onChanged(); this.refresh(); }

  /** Sincroniza controles + lista de pistas + canvas. */
  refresh() {
    const e = this.els, tl = this.tl, clip = this.clip();
    if (!clip) return;
    e.time.textContent = `${tl.time.toFixed(2)} s`;
    e.play.textContent = tl.playing ? '⏸' : '▶';
    if (document.activeElement !== e.dur) e.dur.value = clip.duration;
    if (document.activeElement !== e.bpm) e.bpm.value = clip.bpm;
    e.loop.checked = !!clip.loop; e.auto.checked = !!clip.autoplay;
    e.rec.classList.toggle('on', !!this.ctx.recording());
    // lista de pistas
    const rows = [`<div class="trow head"><span class="name">cues (${clip.cues.length})</span></div>`];
    clip.tracks.forEach((t, i) => rows.push(`<div class="trow${t === this.selTrack ? ' sel' : ''}" data-i="${i}"><span class="name" title="${t.target}">${t.target.replace(/^param:/, '').replace(/^obj:/, '')}</span><button class="mini${t.muted ? '' : ' on'}" data-mute="${i}" title="activar/silenciar">M</button><button class="mini" data-del="${i}" title="borrar pista">×</button></div>`));
    e.tracks.innerHTML = rows.join('');
    for (const b of e.tracks.querySelectorAll('[data-mute]')) b.onclick = () => { const t = clip.tracks[b.dataset.mute]; t.muted = !t.muted; this.changed(); };
    for (const b of e.tracks.querySelectorAll('[data-del]')) b.onclick = () => { clip.tracks.splice(Number(b.dataset.del), 1); this.selKey = null; this.changed(); };
    for (const r of e.tracks.querySelectorAll('.trow[data-i]')) r.onclick = () => { this.selTrack = clip.tracks[r.dataset.i]; this.refresh(); };
    // opciones de pista nueva
    if (e.addTrack.options.length <= 1 || this._optsDirty) {
      e.addTrack.innerHTML = '<option value="">+ pista…</option>' + this.ctx.trackOptions().map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
      this._optsDirty = false;
    }
    this.draw();
  }

  x(t) { return LEFT + t * this.pxPerSec - this.scrollX; }
  t(x) { return (x - LEFT + this.scrollX) / this.pxPerSec; }
  snap(t) {
    if (!this.els.snap.checked) return Math.max(0, t);
    const beat = 60 / (this.clip().bpm || 120);
    return Math.max(0, Math.round(t / beat) * beat);
  }

  draw() {
    const g = this.g, W = this.canvas.width, H = this.canvas.height, clip = this.clip();
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#121216'; g.fillRect(0, 0, W, H);
    if (!clip) return;
    const D = clip.duration, beat = 60 / (clip.bpm || 120);
    // grilla de beats y segundos
    const bar = beat * 4;
    for (let t = 0; t <= D + 1e-6; t += beat) {
      const x = this.x(t); if (x < 0 || x > W) continue;
      const isBar = Math.abs((t / bar) - Math.round(t / bar)) < 1e-6;
      g.strokeStyle = isBar ? '#2c2c38' : '#1b1b23'; g.beginPath(); g.moveTo(x, HEAD); g.lineTo(x, H); g.stroke();
    }
    // filas
    g.fillStyle = '#17171c'; g.fillRect(0, HEAD, W, CUES);
    for (let i = 0; i < clip.tracks.length; i++) { g.strokeStyle = '#26262e'; g.beginPath(); g.moveTo(0, HEAD + CUES + (i + 1) * ROW + 0.5); g.lineTo(W, HEAD + CUES + (i + 1) * ROW + 0.5); g.stroke(); }
    // regla
    g.fillStyle = '#1b1b21'; g.fillRect(0, 0, W, HEAD);
    g.fillStyle = '#8a8a94'; g.font = '10px ui-monospace, monospace'; g.textBaseline = 'top';
    const step = this.pxPerSec >= 40 ? 1 : this.pxPerSec >= 15 ? 5 : 10;
    for (let s = 0; s <= D; s += step) { const x = this.x(s); if (x < 0 || x > W) continue; g.fillRect(x, HEAD - 6, 1, 6); g.fillText(`${s}s`, x + 3, 4); }
    // fin
    const xe = this.x(D); g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(xe, 0, W - xe, H);
    // cues
    for (const c of clip.cues) {
      const x = this.x(c.t); g.fillStyle = c === this.selCue ? '#fff' : '#ffd166';
      g.beginPath(); g.moveTo(x - 5, HEAD + 3); g.lineTo(x + 5, HEAD + 3); g.lineTo(x, HEAD + CUES - 3); g.closePath(); g.fill();
      g.fillStyle = '#ffd166'; g.fillText(c.action?.type ? `${c.action.type} ${c.action.id ?? c.action.value ?? ''}` : 'cue', x + 7, HEAD + 5);
    }
    // keyframes
    clip.tracks.forEach((track, i) => {
      const y = HEAD + CUES + i * ROW + ROW / 2;
      const keys = track.keys;
      if (keys.length > 1) { g.strokeStyle = track.muted ? '#333' : '#3d5a8a'; g.beginPath(); g.moveTo(this.x(keys[0].t), y); g.lineTo(this.x(keys[keys.length - 1].t), y); g.stroke(); }
      for (const k of keys) {
        const x = this.x(k.t);
        g.fillStyle = k === this.selKey ? '#ffffff' : track.muted ? '#555' : '#4fd1c5';
        g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.fill();
      }
    });
    // cabezal
    const xp = this.x(this.tl.time);
    g.strokeStyle = '#ff4fa3'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(xp, 0); g.lineTo(xp, H); g.stroke(); g.lineWidth = 1;
    g.fillStyle = '#ff4fa3'; g.beginPath(); g.moveTo(xp - 6, 0); g.lineTo(xp + 6, 0); g.lineTo(xp, 9); g.closePath(); g.fill();
  }

  pos(ev) { const r = this.canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }

  hit(ev) {
    const { x, y } = this.pos(ev), clip = this.clip();
    if (!clip) return null;
    if (y >= HEAD && y < HEAD + CUES) {
      const cue = clip.cues.find((c) => Math.abs(this.x(c.t) - x) < 7);
      return cue ? { cue } : { cueRow: true };
    }
    const i = Math.floor((y - HEAD - CUES) / ROW);
    if (i < 0 || i >= clip.tracks.length) return { ruler: y < HEAD };
    const track = clip.tracks[i];
    const key = track.keys.find((k) => Math.abs(this.x(k.t) - x) < 7);
    return { track, key };
  }

  onDown(ev) {
    this.canvas.setPointerCapture(ev.pointerId);
    const h = this.hit(ev);
    if (h?.key) { this.selKey = h.key; this.selTrack = h.track; this.selCue = null; this.drag = { key: h.key, track: h.track }; this.ctx.onSelectKey(h.track, h.key); this.refresh(); return; }
    if (h?.cue) { this.selCue = h.cue; this.selKey = null; this.drag = { cue: h.cue }; this.ctx.onSelectCue(h.cue); this.refresh(); return; }
    if (h?.track) this.selTrack = h.track;
    this.drag = { scrub: true };
    this.tl.seek(this.snap(this.t(this.pos(ev).x)));
    this.refresh();
  }

  onMove(ev) {
    if (!this.drag) return;
    const t = this.snap(this.t(this.pos(ev).x));
    if (this.drag.scrub) this.tl.seek(t);
    else if (this.drag.key) { this.drag.key.t = Math.min(this.clip().duration, t); this.drag.track.keys.sort((a, b) => a.t - b.t); this.tl.apply(); this.draw(); }
    else if (this.drag.cue) { this.drag.cue.t = Math.min(this.clip().duration, t); this.draw(); }
  }

  onUp() { if (this.drag && !this.drag.scrub) this.ctx.onChanged(); this.drag = null; this.refresh(); }

  onDbl(ev) {
    const h = this.hit(ev);
    if (h?.track && !h.key) { const v = this.tl.readTarget(h.track.target); this.tl.setKey(h.track.target, v ?? 0, this.snap(this.t(this.pos(ev).x))); this.changed(); }
    else if (h?.cueRow) { this.clip().cues.push({ t: this.snap(this.t(this.pos(ev).x)), action: this.ctx.defaultCueAction() }); this.changed(); }
  }
}
