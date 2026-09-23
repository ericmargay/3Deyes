/**
 * Cliente WebSocket para recibir OSC (vía tools/osc-bridge.js) o cualquier
 * otro programa (Max for Live, TouchDesigner, Python...).
 *
 * Mensajes JSON aceptados:
 *   { "address": "/3deyes/fluid.speed", "args": [0.5] }   → OSC reenviado por el bridge
 *   { "id": "fluid.speed", "value": 2.3 }                  → valor real
 *   { "id": "fluid.speed", "n": 0.5 }                      → normalizado 0..1
 *   { "source": "osc:/knob1", "n": 0.5 }                   → fuente asignable (learn)
 */
export class SocketInput {
  constructor(params, log = console.log, url = 'ws://localhost:8080') {
    this.params = params;
    this.log = log;
    this.url = url;
    this.ws = null;
    this.timer = null;
    this.enabled = false;
  }

  connect() {
    this.enabled = true;
    this.open();
  }

  disconnect() {
    this.enabled = false;
    clearTimeout(this.timer);
    this.ws?.close();
  }

  open() {
    try { this.ws = new WebSocket(this.url); } catch (e) { this.retry(); return; }
    this.ws.onopen = () => this.log(`WS conectado ${this.url}`);
    this.ws.onclose = () => { if (this.enabled) this.retry(); };
    this.ws.onerror = () => {};
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      this.handle(msg);
    };
  }

  retry() { clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), 2000); }

  handle(msg) {
    const p = this.params;
    if (msg.address) {
      const id = msg.address.replace(/^\/3deyes\//, '').replace(/^\//, '').replace(/\//g, '.');
      const v = Array.isArray(msg.args) ? msg.args[0] : msg.args;
      const val = typeof v === 'object' && v !== null ? v.value : v;
      if (p.has(id)) {
        const d = p.def(id);
        // OSC manda valores reales; si el valor está en 0..1 y el rango no, tratarlo como normalizado
        if (d.type === 'number' && (d.min < 0 || d.max > 1) && val >= 0 && val <= 1 && msg.normalized) p.setNormalized(id, val, 'osc');
        else p.set(id, val, 'osc');
      } else {
        p.feed(`osc:${msg.address}`, Number(val), 'osc');
      }
      return;
    }
    if (msg.id && 'value' in msg) p.set(msg.id, msg.value, 'ws');
    else if (msg.id && 'n' in msg) p.setNormalized(msg.id, msg.n, 'ws');
    else if (msg.source && 'n' in msg) p.feed(msg.source, msg.n, 'ws');
  }

  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }
}
