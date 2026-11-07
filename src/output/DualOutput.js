/**
 * Dos proyectores, uno por ojo (estéreo pasivo con filtros polarizados,
 * espejos tipo Wheatstone, o dos murales enfrentados).
 *
 * Abre dos ventanas, "ojo izquierdo" y "ojo derecho". La app renderiza UNA
 * vez por cuadro ambos ojos a la resolución de las salidas y copia cada uno
 * a su ventana: los dos proyectores muestran siempre el mismo instante (dos
 * instancias separadas de la app se desincronizarían: parpadeos, mirada,
 * partículas… y eso arruina la fusión estéreo).
 *
 * La ventana principal queda como monitor de control (GUI + vista previa).
 *
 * En cada ventana de salida:
 *   clic / F   pantalla completa (en la pantalla asignada si el navegador lo permite)
 *   P          ajustar las 4 esquinas (corner-pin propio de ese proyector) · R reset
 *   X          espejo horizontal (proyección trasera o con espejo)
 *   S          intercambiar ojos (las dos salidas)
 *   H          mostrar / ocultar la ayuda
 */
const EYES = [
  { eye: 'L', name: 'ojo izquierdo' },
  { eye: 'R', name: 'ojo derecho' },
];

/** Homografía del cuadrado unidad a 4 puntos (Heckbert) → matrix3d de CSS para un elemento de W × H. */
function cssHomography(c, W, H) {
  const [p0, p1, p2, p3] = c;
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  let a, b, cc, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = p1[0] - p0[0]; b = p2[0] - p1[0]; cc = p0[0]; d = p1[1] - p0[1]; e = p2[1] - p1[1]; f = p0[1]; g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den;
    a = p1[0] - p0[0] + g * p1[0]; b = p3[0] - p0[0] + h * p3[0]; cc = p0[0];
    d = p1[1] - p0[1] + g * p1[1]; e = p3[1] - p0[1] + h * p3[1]; f = p0[1];
  }
  // las esquinas están en píxeles de la ventana; el elemento mide W × H
  a /= W; d /= W; g /= W; b /= H; e /= H; h /= H;
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${cc},${f},0,1)`;
}

export class DualOutput {
  constructor(params, log = console.log, onChange = () => {}) {
    this.params = params;
    this.log = log;
    this.onChange = onChange;
    this.list = EYES.map((e) => ({ ...e, win: null, canvas: null, ctx: null, edit: false, screen: null, pin: this.loadPin(e.eye), lastW: 0, lastH: 0 }));
    params.define('salidas.vista', { type: 'option', options: ['lado a lado', 'anaglifo', 'izquierdo', 'nada'], default: 'lado a lado', label: 'vista previa en esta ventana' });
    params.define('salidas.espejoL', { default: false, label: 'espejo ojo izquierdo' });
    params.define('salidas.espejoR', { default: false, label: 'espejo ojo derecho' });
    params.define('salidas.brilloL', { min: 0.3, max: 1.5, default: 1, step: 0.01, label: 'brillo ojo izquierdo' });
    params.define('salidas.brilloR', { min: 0.3, max: 1.5, default: 1, step: 0.01, label: 'brillo ojo derecho' });
    window.addEventListener('beforeunload', () => this.close());
  }

  get active() { return this.list.some((o) => this.isOpen(o)); }
  isOpen(o) { return !!(o.win && !o.win.closed); }

  /** Resolución de render de los ojos: la mayor de las ventanas abiertas (en píxeles reales). */
  size() {
    let w = 2, h = 2;
    for (const o of this.list) if (this.isOpen(o)) {
      const dpr = o.win.devicePixelRatio || 1;
      w = Math.max(w, Math.round(o.win.innerWidth * dpr)); h = Math.max(h, Math.round(o.win.innerHeight * dpr));
    }
    return { w: Math.min(w, 4096), h: Math.min(h, 4096) };
  }

  /** Abre (o recupera) las dos ventanas. Llamar desde un gesto del usuario (clic, tecla). */
  async open() {
    let screens = null, here = null;
    try {
      if ('getScreenDetails' in window) { const d = await window.getScreenDetails(); screens = d.screens; here = d.currentScreen; }
    } catch (_) { /* sin permiso: se acomodan a mano */ }
    const others = screens ? screens.filter((s) => s !== here) : [];
    this.list.forEach((o, i) => {
      if (this.isOpen(o)) return;
      const sc = others[i] || others[0] || null;
      o.screen = sc;
      const feat = sc
        ? `left=${sc.availLeft},top=${sc.availTop},width=${sc.availWidth},height=${sc.availHeight}`
        : `left=${80 + i * 660},top=80,width=640,height=360`;
      const win = window.open('', `3deyes-salida-${o.eye}`, feat);
      if (!win) { this.log('salidas: el navegador bloqueó la ventana (permitir ventanas emergentes para este sitio)'); return; }
      o.win = win;
      this.build(o);
    });
    if (this.active) this.log(screens ? `salidas abiertas (${screens.length} pantallas detectadas)` : 'salidas abiertas: llevar cada ventana a su proyector y hacer clic para pantalla completa');
    this.onChange();
  }

  close() { for (const o of this.list) if (this.isOpen(o)) o.win.close(); this.onChange(); }
  toggle() { if (this.active) this.close(); else this.open(); }

  build(o) {
    const win = o.win, doc = win.document;
    doc.title = `3Deyes · ${o.name}`;
    doc.body.innerHTML = '';
    const style = doc.createElement('style');
    style.textContent = `
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; user-select: none; -webkit-user-select: none; }
      body.edit { cursor: default; }
      canvas { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; transform-origin: 0 0; }
      .tip { position: fixed; left: 12px; bottom: 12px; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #ddd; background: rgba(0,0,0,.6); padding: 8px 10px; border-radius: 6px; white-space: pre; }
      .eye { position: fixed; right: 12px; top: 12px; font: 600 28px ui-monospace, Menlo, monospace; color: #ff4fa3; opacity: .85; }
      .h { position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 2px solid #ff4fa3; background: rgba(255,79,163,.25); cursor: grab; display: none; }
      body.edit .h { display: block; }`;
    doc.head.appendChild(style);
    o.canvas = doc.createElement('canvas');
    o.ctx = o.canvas.getContext('2d', { alpha: false, desynchronized: true });
    doc.body.appendChild(o.canvas);
    const label = doc.createElement('div'); label.className = 'eye'; label.textContent = o.eye === 'L' ? 'L' : 'R';
    const tip = doc.createElement('div'); tip.className = 'tip';
    tip.textContent = `3Deyes · ${o.name}\nclic / F: pantalla completa   P: esquinas (R reset)   X: espejo   S: intercambiar ojos   H: ayuda`;
    doc.body.append(label, tip);
    o.tip = tip; o.label = label;
    setTimeout(() => { if (!o.edit) { tip.style.display = 'none'; label.style.display = 'none'; } }, 7000);
    // manijas del corner-pin
    o.handles = [0, 1, 2, 3].map((i) => {
      const hEl = doc.createElement('div'); hEl.className = 'h'; doc.body.appendChild(hEl);
      let drag = false;
      hEl.addEventListener('pointerdown', (ev) => { drag = true; hEl.setPointerCapture(ev.pointerId); ev.preventDefault(); ev.stopPropagation(); });
      hEl.addEventListener('pointermove', (ev) => { if (!drag) return; o.pin[i] = [ev.clientX / win.innerWidth, ev.clientY / win.innerHeight]; this.applyPin(o); });
      hEl.addEventListener('pointerup', () => { drag = false; this.savePin(o); });
      return hEl;
    });
    const fullscreen = () => {
      const el = doc.documentElement;
      if (doc.fullscreenElement) { doc.exitFullscreen?.(); return; }
      (o.screen ? el.requestFullscreen({ screen: o.screen }) : el.requestFullscreen())?.catch?.(() => {});
    };
    doc.addEventListener('click', () => { if (!o.edit) fullscreen(); });
    doc.addEventListener('keydown', (ev) => {
      const k = ev.key.toLowerCase();
      if (k === 'f') fullscreen();
      else if (k === 'p' || (k === 'escape' && o.edit)) { o.edit = !o.edit && k === 'p'; doc.body.classList.toggle('edit', o.edit); tip.style.display = label.style.display = o.edit ? 'block' : 'none'; this.applyPin(o); }
      else if (k === 'r' && o.edit) { o.pin = [[0, 0], [1, 0], [1, 1], [0, 1]]; this.applyPin(o); this.savePin(o); }
      else if (k === 'x') this.params.set(`salidas.espejo${o.eye}`, !this.params.get(`salidas.espejo${o.eye}`));
      else if (k === 's') this.params.set('stereo.swap', !this.params.get('stereo.swap'));
      else if (k === 'h') { const show = tip.style.display === 'none'; tip.style.display = label.style.display = show ? 'block' : 'none'; }
    });
    win.addEventListener('resize', () => { this.applyPin(o); this.onChange(); });
    this.applyPin(o);
  }

  applyPin(o) {
    if (!this.isOpen(o)) return;
    const W = o.win.innerWidth, H = o.win.innerHeight;
    const px = o.pin.map(([x, y]) => [x * W, y * H]);
    o.canvas.style.transform = cssHomography(px, W, H);
    o.handles?.forEach((h, i) => { h.style.left = `${px[i][0]}px`; h.style.top = `${px[i][1]}px`; });
  }

  /** Copia del canvas de la app (región abajo-izquierda de vw × vh, y en coords de canvas = sy) a la ventana. */
  copy(o, src, sy, vw, vh) {
    const dpr = o.win.devicePixelRatio || 1;
    const W = Math.round(o.win.innerWidth * dpr), H = Math.round(o.win.innerHeight * dpr);
    if (o.canvas.width !== W || o.canvas.height !== H) { o.canvas.width = W; o.canvas.height = H; }
    const ctx = o.ctx;
    const mirror = this.params.get(`salidas.espejo${o.eye}`);
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? W : 0, 0);
    ctx.drawImage(src, 0, sy, vw, vh, 0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const b = this.params.get(`salidas.brillo${o.eye}`);
    const filter = b === 1 ? '' : `brightness(${b})`;
    if (o.canvas.style.filter !== filter) o.canvas.style.filter = filter;
    if (o.edit) {
      ctx.strokeStyle = 'rgba(255,79,163,.8)'; ctx.lineWidth = Math.max(1, W / 800);
      for (let i = 0; i <= 8; i++) {
        ctx.beginPath(); ctx.moveTo((i / 8) * W, 0); ctx.lineTo((i / 8) * W, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (i / 8) * H); ctx.lineTo(W, (i / 8) * H); ctx.stroke();
      }
    }
  }

  loadPin(eye) {
    try { const s = localStorage.getItem(`3deyes.salida.${eye}`); if (s) return JSON.parse(s); } catch (_) { /* */ }
    return [[0, 0], [1, 0], [1, 1], [0, 1]];
  }
  savePin(o) { try { localStorage.setItem(`3deyes.salida.${o.eye}`, JSON.stringify(o.pin)); } catch (_) { /* */ } }
}
