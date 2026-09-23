/**
 * Puente OSC (UDP) → WebSocket para el navegador.
 *
 *   npm run osc-bridge
 *
 * Escucha OSC en udp://0.0.0.0:9000 y reenvía cada mensaje como JSON por
 * ws://localhost:8080. Desde Ableton (Max for Live, "OSC Send"), TouchDesigner,
 * Pure Data, Python, etc. mandar:
 *
 *   /3deyes/fluid.speed 2.5      → fija el parámetro fluid.speed a 2.5 (valor real)
 *   /3deyes/stereo.mode 2        → índice en las opciones (0 mono, 1 parallel, 2 cross...)
 *   /knob1 0.3                   → fuente "osc:/knob1", asignable con learn en la GUI
 */
import osc from 'osc';
import { WebSocketServer } from 'ws';

const UDP_PORT = Number(process.env.OSC_PORT || 9000);
const WS_PORT = Number(process.env.WS_PORT || 8080);

const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (data) => {
    // el navegador puede mandar mensajes de vuelta (por ejemplo a Ableton)
    try {
      const msg = JSON.parse(data);
      if (msg.address) udp.send({ address: msg.address, args: (msg.args ?? []).map((v) => ({ type: 'f', value: v })) }, msg.host || '127.0.0.1', msg.port || 9001);
    } catch (_) { /* ignora */ }
  });
});

const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: UDP_PORT, metadata: true });
udp.on('message', (m) => {
  const json = JSON.stringify({ address: m.address, args: m.args.map((a) => a.value) });
  for (const c of clients) if (c.readyState === 1) c.send(json);
});
udp.on('error', (e) => console.error('OSC error', e.message));
udp.open();

console.log(`OSC escuchando en udp://0.0.0.0:${UDP_PORT}  →  ws://localhost:${WS_PORT}`);
