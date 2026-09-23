/**
 * Entrada serial (Web Serial API) para ESP32 / Arduino.
 *
 * Protocolo de texto, una línea por mensaje, terminada en \n:
 *   k0 0.53              → fuente "serial:k0" con valor normalizado 0..1
 *   k1 812 0 4095        → valor crudo + rango (se normaliza aquí)
 *   fluid.speed 0.4      → asigna directo por id de parámetro (normalizado 0..1)
 *   {"k0":0.5,"k1":0.2}  → JSON con varias fuentes/ids a la vez
 *
 * Ver tools/esp32/esp32_params.ino para el sketch de ejemplo.
 * Requiere Chrome/Edge y un gesto del usuario para elegir el puerto.
 */
export class SerialInput {
  constructor(params, log = console.log) {
    this.params = params;
    this.log = log;
    this.port = null;
    this.reader = null;
    this.connected = false;
    this.baud = 115200;
  }

  async connect() {
    if (!navigator.serial) { this.log('Web Serial no disponible (usar Chrome/Edge)'); return false; }
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: this.baud });
    } catch (e) { this.log(`Serial: ${e.message}`); return false; }
    this.connected = true;
    this.log(`Serial conectado @${this.baud}`);
    this.readLoop();
    return true;
  }

  async disconnect() {
    this.connected = false;
    try { await this.reader?.cancel(); await this.port?.close(); } catch (_) { /* */ }
    this.log('Serial desconectado');
  }

  async readLoop() {
    const decoder = new TextDecoderStream();
    this.port.readable.pipeTo(decoder.writable).catch(() => {});
    this.reader = decoder.readable.getReader();
    let buf = '';
    try {
      while (this.connected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) this.handleLine(line);
        }
      }
    } catch (e) { this.log(`Serial error: ${e.message}`); }
    this.connected = false;
  }

  handleLine(line) {
    if (line[0] === '{') {
      try {
        const obj = JSON.parse(line);
        for (const [k, v] of Object.entries(obj)) this.feed(k, Number(v));
      } catch (_) { /* línea inválida */ }
      return;
    }
    const parts = line.split(/[\s,;=]+/);
    if (parts.length < 2) return;
    const key = parts[0];
    let n = Number(parts[1]);
    if (parts.length >= 4) {
      const lo = Number(parts[2]), hi = Number(parts[3]);
      n = hi !== lo ? (n - lo) / (hi - lo) : 0;
    }
    this.feed(key, n);
  }

  feed(key, n) {
    if (Number.isNaN(n)) return;
    const src = key.includes('.') ? key : `serial:${key}`;
    this.params.feed(src, n, 'serial');
  }

  /** Envía una línea al ESP32 (por ejemplo para leds o motores que reaccionan a la escena). */
  async send(text) {
    if (!this.port?.writable) return;
    const w = this.port.writable.getWriter();
    try { await w.write(new TextEncoder().encode(text + '\n')); } finally { w.releaseLock(); }
  }
}
