/**
 * Pad XY tipo Kaoss Pad (Korg): un cuadrado táctil que publica X, Y y "toque"
 * en el bus. Mientras se toca, el efecto está enganchado; al soltar se va
 * (salvo HOLD). Cada escena decide qué hacen X e Y (y lo rotula en el pad).
 *
 *  · overlay en la ventana (tecla Z), o
 *  · ventana aparte ("pad en ventana"): el pad en otra pantalla / tablet
 *    mientras el proyector muestra la escena limpia.
 *  · hardware: un Kaoss Pad real manda CC12 (X), CC13 (Y) y CC92 (toque):
 *    asignarlos con learn a kaoss.x, kaoss.y, kaoss.toque. También OSC / ESP32.
 *
 * Parámetros: kaoss.x, kaoss.y (0..1), kaoss.toque, kaoss.hold, kaoss.programa
 * Fuentes:    kaoss:x, kaoss:y, kaoss:touch (asignables con learn a cualquier parámetro)
 */
export const KAOSS_PROGRAMS = ['estrobo', 'persecución', 'aleatorio', 'espejo', 'ola', 'tartamudeo', 'filtro', 'eco'];

const CSS = `
  #kaoss { position: fixed; right: 16px; bottom: 16px; z-index: 40; width: 300px; user-select: none; -webkit-user-select: none;
    background: rgba(10,8,16,.86); border: 1px solid #3a2a4a; border-radius: 12px; padding: 8px; font: 11px/1.4 ui-monospace, Menlo, monospace; color: #ddd; backdrop-filter: blur(6px); }
  #kaoss.hidden { display: none; }
  #kaoss .bar { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
  #kaoss .bar .t { flex: 1; color: #ff9ad1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #kaoss button { font: inherit; padding: 3px 7px; border-radius: 6px; border: 1px solid #4a3a5a; background: #1b1530; color: #eee; cursor: pointer; }
  #kaoss button.on { background: #ff4fa3; color: #000; border-color: #ff4fa3; }
  #kaoss canvas { width: 284px; height: 284px; display: block; border-radius: 8px; touch-action: none; cursor: crosshair; }
  #kaoss .ax { display: flex; justify-content: space-between; color: #999; margin-top: 4px; }
`;

export class KaossPad {
  constructor(params, log = console.log) {
    this.params = params; this.log = log;
    this.labels = { title: 'Kaoss', x: 'X', y: 'Y', programs: true };
    this.trail = [];
    this.down = false;
    this.win = null;
    const p = params, d = (id, o) => { if (!p.has(id)) p.define(id, o); };
    d('kaoss.x', { min: 0, max: 1, default: 0.5, step: 0.001, label: 'X' });
    d('kaoss.y', { min: 0, max: 1, default: 0.5, step: 0.001, label: 'Y' });
    d('kaoss.toque', { default: false, label: 'toque (efecto enganchado)' });
    d('kaoss.hold', { default: false, label: 'hold (queda enganchado al soltar)' });
    d('kaoss.programa', { type: 'option', options: KAOSS_PROGRAMS, default: 'estrobo', label: 'programa' });
    d('kaoss.siguiente', { type: 'trigger', label: 'siguiente programa' });
    p.onChange((id) => { if (id === 'kaoss.siguiente') this.step(1); if (id === 'kaoss.hold' || id === 'kaoss.programa') this.refresh(); });
    if (typeof document !== 'undefined') this.build();
  }

  get x() { return this.params.get('kaoss.x'); }
  get y() { return this.params.get('kaoss.y'); }
  get touch() { return this.params.get('kaoss.toque'); }
  get hold() { return this.params.get('kaoss.hold'); }
  /** Efecto enganchado: tocando o en hold. */
  get active() { return this.touch || this.hold; }
  get program() { return this.params.get('kaoss.programa'); }
  get visible() { return this.el && !this.el.classList.contains('hidden'); }

  step(d) { const i = KAOSS_PROGRAMS.indexOf(this.program); this.params.set('kaoss.programa', KAOSS_PROGRAMS[(i + d + KAOSS_PROGRAMS.length) % KAOSS_PROGRAMS.length], 'pad'); }

  /** La escena actual rotula los ejes: { title, x, y, programs: bool } */
  setLabels(l) { this.labels = { title: 'Kaoss', x: 'X', y: 'Y', programs: true, ...l }; this.refresh(); }

  build(doc = document, host = null) {
    if (!doc.getElementById('kaossCss')) { const st = doc.createElement('style'); st.id = 'kaossCss'; st.textContent = CSS; doc.head.appendChild(st); }
    const el = doc.createElement('div'); el.id = 'kaoss'; if (!host) el.classList.add('hidden');
    el.innerHTML = `<div class="bar"><span class="t"></span><button data-k="prev">◀</button><button data-k="next">▶</button><button data-k="hold">HOLD</button>${host ? '' : '<button data-k="win" title="abrir el pad en otra ventana">⧉</button><button data-k="close">×</button>'}</div>
      <canvas width="568" height="568"></canvas><div class="ax"><span class="lx"></span><span class="ly"></span></div>`;
    (host || doc.body).appendChild(el);
    const ui = { el, title: el.querySelector('.t'), canvas: el.querySelector('canvas'), lx: el.querySelector('.lx'), ly: el.querySelector('.ly'), hold: el.querySelector('[data-k=hold]'), prev: el.querySelector('[data-k=prev]'), next: el.querySelector('[data-k=next]') };
    ui.ctx = ui.canvas.getContext('2d');
    el.querySelector('[data-k=prev]').onclick = () => this.step(-1);
    el.querySelector('[data-k=next]').onclick = () => this.step(1);
    ui.hold.onclick = () => this.params.set('kaoss.hold', !this.hold, 'pad');
    el.querySelector('[data-k=close]')?.addEventListener('click', () => this.toggle(false));
    el.querySelector('[data-k=win]')?.addEventListener('click', () => this.openWindow());
    const pos = (e) => { const r = ui.canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]; };
    ui.canvas.addEventListener('pointerdown', (e) => { ui.canvas.setPointerCapture(e.pointerId); this.down = true; this.set(...pos(e), true); e.preventDefault(); });
    ui.canvas.addEventListener('pointermove', (e) => { if (this.down) this.set(...pos(e), true); });
    const up = () => { if (!this.down) return; this.down = false; this.params.set('kaoss.toque', false, 'pad'); };
    ui.canvas.addEventListener('pointerup', up); ui.canvas.addEventListener('pointercancel', up);
    if (!host) { this.el = el; this.ui = ui; } else this.winUi = ui;
    this.refresh();
    return ui;
  }

  set(x, y, touch) {
    const p = this.params;
    p.set('kaoss.x', x, 'pad'); p.set('kaoss.y', y, 'pad'); if (touch !== undefined) p.set('kaoss.toque', touch, 'pad');
  }

  toggle(show = !this.visible) { this.el?.classList.toggle('hidden', !show); }

  openWindow() {
    if (this.win && !this.win.closed) { this.win.focus(); return; }
    const w = window.open('', '3deyes-kaoss', 'width=340,height=400');
    if (!w) { this.log('kaoss: el navegador bloqueó la ventana'); return; }
    this.win = w;
    w.document.title = '3Deyes · Kaoss pad';
    w.document.body.style.cssText = 'margin:0;background:#07050c;display:flex;align-items:center;justify-content:center;height:100vh';
    this.build(w.document, w.document.body);
    w.addEventListener('beforeunload', () => { this.winUi = null; });
    this.toggle(false);
  }

  refresh() {
    for (const ui of [this.ui, this.winUi]) {
      if (!ui) continue;
      const L = this.labels;
      ui.title.textContent = L.programs ? `${L.title} · ${this.program}` : L.title;
      ui.lx.textContent = `X → ${L.x}`; ui.ly.textContent = `Y ↑ ${L.y}`;
      ui.hold.classList.toggle('on', this.hold);
      ui.prev.style.display = ui.next.style.display = L.programs ? '' : 'none';
    }
  }

  /** Por cuadro: publica las fuentes y dibuja. */
  update(dt) {
    const p = this.params;
    p.feed('kaoss:x', this.x, 'pad'); p.feed('kaoss:y', this.y, 'pad'); p.feed('kaoss:touch', this.active ? 1 : 0, 'pad');
    if (this.active) this.trail.push({ x: this.x, y: this.y, a: 1 });
    for (const t of this.trail) t.a -= dt * 2.2;
    this.trail = this.trail.filter((t) => t.a > 0).slice(-60);
    for (const ui of [this.ui, this.winUi]) if (ui && (ui === this.winUi || this.visible)) this.draw(ui);
  }

  draw(ui) {
    const c = ui.ctx, W = ui.canvas.width, H = ui.canvas.height;
    c.fillStyle = '#0b0912'; c.fillRect(0, 0, W, H);
    // matriz de LEDs como en el Kaoss Pad
    const n = 16, s = W / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const cx = (i + 0.5) / n, cy = 1 - (j + 0.5) / n;
      let v = 0.06;
      for (const t of this.trail) { const d = Math.hypot(cx - t.x, cy - t.y); v += Math.max(0, 1 - d * 9) * t.a * 0.7; }
      if (this.active) { const d = Math.hypot(cx - this.x, cy - this.y); v += Math.max(0, 1 - d * 6) * 1.2; }
      v = Math.min(1, v);
      c.fillStyle = `rgba(255,${Math.round(60 + 120 * v)},${Math.round(150 + 60 * v)},${0.12 + 0.88 * v})`;
      c.beginPath(); c.arc((i + 0.5) * s, (j + 0.5) * s, s * 0.32, 0, Math.PI * 2); c.fill();
    }
    // cruz en la posición actual
    const x = this.x * W, y = (1 - this.y) * H;
    c.strokeStyle = this.active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }
}
