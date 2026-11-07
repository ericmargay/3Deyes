/**
 * Entrada MIDI (Web MIDI API). Sirve para Ableton Live:
 *   macOS: Ableton → Preferences → MIDI → Output: "IAC Driver Bus 1" (Track + Remote)
 *   Un clip MIDI con automatización de CC en un track cuya salida sea IAC.
 *   El navegador (Chrome/Edge) recibe los CC y los mapea a parámetros.
 *
 * Fuentes generadas:
 *   "midi:<canal>:cc<numero>"    para Control Change (valor 0..127 → 0..1)
 *   "midi:<canal>:note<numero>"  para Note On (velocidad → 0..1), Note Off → 0
 *   (además, onNote(fn) avisa cada nota: las escenas pueden crear objetos en el acto)
 *   "midi:<canal>:pitch"         pitch bend → 0..1
 *
 * Reloj MIDI (Ableton → Preferences → Link/Tempo/MIDI → Output IAC: "Sync" ✔):
 * 24 pulsos por negra + start / stop / continue / song position. `clock`
 * expone el tempo y la posición en beats para que las escenas queden en fase
 * con el set (ver diosas.ritmo.fuente = "midi clock").
 *
 * Asignación: doble clic sobre el nombre de un parámetro en la GUI (modo learn)
 * y mover el control en Ableton / controlador.
 */
export class MidiInput {
  constructor(params, log = console.log) {
    this.params = params;
    this.log = log;
    this.access = null;
    this.inputs = [];
    this.lastKey = null;
    this.clock = new MidiClock();
    this.noteListeners = new Set();
  }

  /** Avisa cada Note On: fn({ ch, note, vel }) (vel 0..1). Devuelve la función para desuscribirse. */
  onNote(fn) { this.noteListeners.add(fn); return () => this.noteListeners.delete(fn); }

  async connect() {
    if (!navigator.requestMIDIAccess) { this.log('MIDI no disponible en este navegador'); return false; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) { this.log('MIDI: permiso denegado'); return false; }
    const attach = () => {
      this.inputs = [...this.access.inputs.values()];
      for (const inp of this.inputs) inp.onmidimessage = (m) => this.onMessage(m);
      this.log(`MIDI: ${this.inputs.length} entrada(s): ${this.inputs.map((i) => i.name).join(', ') || '—'}`);
    };
    this.access.onstatechange = attach;
    attach();
    return true;
  }

  onMessage(m) {
    const [status, d1, d2] = m.data;
    if (status >= 0xf2) { this.clock.message(status, d1, d2, m.timeStamp); return; }
    const type = status & 0xf0, ch = (status & 0x0f) + 1;
    let key = null, n = 0;
    if (type === 0xb0) { key = `midi:${ch}:cc${d1}`; n = d2 / 127; }
    else if (type === 0x90) { key = `midi:${ch}:note${d1}`; n = d2 / 127; if (d2 > 0) for (const fn of this.noteListeners) fn({ ch, note: d1, vel: n }); }
    else if (type === 0x80) { key = `midi:${ch}:note${d1}`; n = 0; }
    else if (type === 0xe0) { key = `midi:${ch}:pitch`; n = ((d2 << 7) | d1) / 16383; }
    if (!key) return;
    this.lastKey = key;
    this.params.feed(key, n, 'midi');
  }
}

/** Reloj MIDI: tempo y posición en beats (negras) a partir de los pulsos 0xF8. */
export class MidiClock {
  constructor() {
    this.running = false;
    this.ticks = 0;        // pulsos desde el start (24 por beat)
    this.bpm = 0;
    this.lastTick = 0;     // performance.now() del último pulso
    this.interval = 0;     // ms entre pulsos (suavizado)
    this.seen = 0;         // último pulso recibido (para saber si sigue llegando)
  }

  message(status, d1, d2, stamp = performance.now()) {
    if (status === 0xf8) {
      if (this.lastTick) {
        const dt = stamp - this.lastTick;
        if (dt > 2 && dt < 100) this.interval = this.interval ? this.interval * 0.9 + dt * 0.1 : dt;
        if (this.interval) this.bpm = Math.round((60000 / (this.interval * 24)) * 10) / 10;
      }
      this.lastTick = stamp; this.seen = performance.now();
      if (this.running) this.ticks++;
    } else if (status === 0xfa) { this.running = true; this.ticks = 0; }
    else if (status === 0xfb) { this.running = true; }
    else if (status === 0xfc) { this.running = false; }
    else if (status === 0xf2) { this.ticks = ((d2 << 7) | d1) * 6; }   // song position: semicorcheas
  }

  /** ¿Llegan pulsos? (Ableton manda reloj aunque el transporte esté detenido) */
  get alive() { return performance.now() - this.seen < 500; }

  /** Posición actual en beats, interpolada entre pulsos. */
  position() {
    const frac = this.interval ? Math.min(1, (performance.now() - this.lastTick) / this.interval) : 0;
    return (this.ticks + (this.running ? frac : 0)) / 24;
  }
}
