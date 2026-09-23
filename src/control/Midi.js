/**
 * Entrada MIDI (Web MIDI API). Sirve para Ableton Live:
 *   macOS: Ableton → Preferences → MIDI → Output: "IAC Driver Bus 1" (Track + Remote)
 *   Un clip MIDI con automatización de CC en un track cuya salida sea IAC.
 *   El navegador (Chrome/Edge) recibe los CC y los mapea a parámetros.
 *
 * Fuentes generadas:
 *   "midi:<canal>:cc<numero>"    para Control Change (valor 0..127 → 0..1)
 *   "midi:<canal>:note<numero>"  para Note On (velocidad → 0..1), Note Off → 0
 *   "midi:<canal>:pitch"         pitch bend → 0..1
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
  }

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
    const type = status & 0xf0, ch = (status & 0x0f) + 1;
    let key = null, n = 0;
    if (type === 0xb0) { key = `midi:${ch}:cc${d1}`; n = d2 / 127; }
    else if (type === 0x90) { key = `midi:${ch}:note${d1}`; n = d2 / 127; }
    else if (type === 0x80) { key = `midi:${ch}:note${d1}`; n = 0; }
    else if (type === 0xe0) { key = `midi:${ch}:pitch`; n = ((d2 << 7) | d1) / 16383; }
    if (!key) return;
    this.lastKey = key;
    this.params.feed(key, n, 'midi');
  }
}
