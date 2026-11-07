#!/usr/bin/env node
/**
 * Puente Art-Net: el navegador no puede mandar UDP, así que la app manda los
 * universos DMX por WebSocket a este proceso y él los reparte por Art-Net
 * (UDP 6454) a cada ESP32 / nodo DMX de la red.
 *
 *   npm run artnet-bridge            escucha ws://localhost:8081
 *   ARTNET_WS_PORT=9001 node tools/artnet-bridge.js
 *
 * Mensaje esperado: { artnet: [ { ip: "2.0.0.10", universe: 0, data: "<base64 de 512 bytes>" } ] }
 * ip puede ser una dirección de difusión (2.255.255.255 / 192.168.1.255).
 */
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';

const WS_PORT = Number(process.env.ARTNET_WS_PORT || 8081);
const udp = dgram.createSocket('udp4');
udp.bind(() => udp.setBroadcast(true));
let seq = 1, sent = 0, lastLog = Date.now();
const header = Buffer.from('Art-Net\0', 'ascii');

function artDmx(universe, data) {
  const b = Buffer.alloc(18 + data.length);
  header.copy(b, 0);
  b.writeUInt16LE(0x5000, 8);            // OpDmx
  b.writeUInt16BE(14, 10);               // versión del protocolo
  b[12] = seq = (seq % 255) + 1;         // secuencia
  b[13] = 0;                             // puerto físico
  b[14] = universe & 0xff;               // sub-uni
  b[15] = (universe >> 8) & 0x7f;        // net
  b.writeUInt16BE(data.length, 16);
  data.copy(b, 18);
  return b;
}

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`Art-Net bridge: ws://localhost:${WS_PORT} → udp 6454`);
wss.on('connection', (ws) => {
  console.log('app conectada');
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
    for (const f of msg.artnet || []) {
      const data = Buffer.from(f.data, 'base64');
      if (data.length < 2) continue;
      const pkt = artDmx(f.universe | 0, data.length % 2 ? Buffer.concat([data, Buffer.alloc(1)]) : data);
      udp.send(pkt, 6454, f.ip, (err) => { if (err && Date.now() - lastLog > 2000) { lastLog = Date.now(); console.warn(`udp ${f.ip}: ${err.message}`); } });
      sent++;
    }
  });
});
setInterval(() => { if (sent) { console.log(`${sent} paquetes en 10 s`); sent = 0; } }, 10000);
