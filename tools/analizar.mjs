#!/usr/bin/env node
/**
 * Analiza un archivo de audio desde la terminal (mismo código que el worker)
 * e imprime tempo, beats, secciones y notas. Útil para probar el análisis sin
 * abrir el navegador.
 *
 *   node tools/analizar.mjs "tema.mp3"            → resumen
 *   node tools/analizar.mjs "tema.mp3" --json out.json
 *   node tools/analizar.mjs "tema.mp3" --png out.png   (curvas de onsets con beats y secciones)
 *
 * Necesita ffmpeg en el PATH para decodificar.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { analyze, BANDS } from '../src/music/analysis.js';
import { NOTE_NAMES } from '../src/music/dsp.js';

const file = process.argv[2];
if (!file) { console.error('uso: node tools/analizar.mjs archivo [--json out] [--png out]'); process.exit(1); }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const sr = 44100;
const t0 = Date.now();
const raw = file.endsWith('.f32') ? fs.readFileSync(file) : execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
console.log(`decodificado: ${(pcm.length / sr).toFixed(1)} s en ${Date.now() - t0} ms`);
const t1 = Date.now();
let lastMsg = '';
const A = analyze(pcm, sr, (p, msg) => { if (msg !== lastMsg) { lastMsg = msg; process.stdout.write(`  ${msg}… `); } });
console.log(`\nanálisis: ${Date.now() - t1} ms`);
console.log(`bpm ${A.bpm} (confianza ${A.tempoConfidence.toFixed(2)}) candidatos: ${A.bpmCandidates.map((c) => `${c.bpm}:${c.score.toFixed(2)}`).join('  ')}`);
console.log(`beats ${A.beats.length} · downbeats ${A.downbeat.reduce((a, b) => a + b, 0)} · primer beat ${A.beats[0].toFixed(2)} s`);
const iv = []; for (let i = 1; i < A.beats.length; i++) iv.push(A.beats[i] - A.beats[i - 1]);
iv.sort((a, b) => a - b);
console.log(`intervalo entre beats: mediana ${(iv[iv.length >> 1] * 1000).toFixed(1)} ms · p5 ${(iv[Math.floor(iv.length * 0.05)] * 1000).toFixed(1)} · p95 ${(iv[Math.floor(iv.length * 0.95)] * 1000).toFixed(1)}`);
// ¿qué tan bien caen los beats sobre la envolvente? (comparado con posiciones desplazadas medio beat)
const fpsA = A.fps; let onB = 0, offB = 0;
for (let i = 0; i < A.beats.length - 1; i++) { const f = Math.round(A.beats[i] * fpsA), h = Math.round(((A.beats[i] + A.beats[i + 1]) / 2) * fpsA); onB += A.odf[f] || 0; offB += A.odf[h] || 0; }
console.log(`envolvente en beats ${(onB / A.beats.length).toFixed(3)} vs a contratiempo ${(offB / A.beats.length).toFixed(3)}`);
for (const b of A.bands) console.log(`  ${b.label.padEnd(12)} onsets ${String(b.onsets.length).padStart(5)}   fuertes (>0.6) ${b.onsets.filter((o) => o.s > 0.6).length}`);
console.log('secciones:');
const letters = 'ABCDEFGHIJ';
for (const s of A.sections) console.log(`  ${fmt(s.t0)} – ${fmt(s.t1)}  ${letters[s.type] || s.type}  energía ${s.energy.toFixed(2)}  (${s.b1 - s.b0} beats, ${((s.b1 - s.b0) / 4).toFixed(1)} compases)`);
console.log(`notas: ${A.notes.length}`);
const hist = new Map(); for (const n of A.notes) hist.set(n.midi % 12, (hist.get(n.midi % 12) || 0) + 1);
console.log('  clases de altura: ' + [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${NOTE_NAMES[k]}×${v}`).join(' '));
console.log('  primeras: ' + A.notes.slice(0, 12).map((n) => `${NOTE_NAMES[n.midi % 12]}${Math.floor(n.midi / 12) - 1}@${n.t0.toFixed(2)}(${(n.t1 - n.t0).toFixed(2)}s)`).join(' '));

if (arg('--json')) {
  const o = { ...A, beats: [...A.beats], downbeat: [...A.downbeat], barOf: [...A.barOf], beatInBar: [...A.beatInBar], beatStrength: [...A.beatStrength], odf: null, loud: null, chroma: null, salience: null, melody: null, bands: A.bands.map((b) => ({ key: b.key, onsets: b.onsets })) };
  fs.writeFileSync(arg('--json'), JSON.stringify(o)); console.log('json →', arg('--json'));
}
if (arg('--png')) {
  // imagen: 5 curvas de flujo (una por banda) + beats (líneas) + downbeats (más altas) + secciones (fondo)
  const secs = +(arg('--desde') || 0), span = +(arg('--segundos') || 30);
  const W = 1800, H = 600, img = new Uint8Array(W * H * 3).fill(10);
  const f0 = Math.round(secs * A.fps), f1 = Math.min(A.nFrames, Math.round((secs + span) * A.fps));
  const px = (f) => Math.round(((f - f0) / (f1 - f0)) * (W - 1));
  const put = (x, y, r, g, b) => { if (x < 0 || x >= W || y < 0 || y >= H) return; const i = (y * W + x) * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; };
  const secCol = [[40, 20, 60], [20, 50, 60], [60, 40, 20], [25, 60, 30], [60, 25, 45], [30, 30, 70]];
  for (const s of A.sections) { const a = Math.max(0, px(s.t0 * A.fps)), b = Math.min(W - 1, px(s.t1 * A.fps)); const c = secCol[s.type % secCol.length]; for (let x = a; x <= b; x++) for (let y = 0; y < H; y++) put(x, y, c[0], c[1], c[2]); }
  const rowH = H / 6;
  const bandCol = [[255, 80, 80], [255, 160, 60], [120, 255, 120], [80, 200, 255], [220, 160, 255]];
  for (let b = 0; b < 5; b++) {
    const f = A.bands[b].flux, p = Math.max(...Array.from(f.subarray(f0, f1))) || 1;
    for (let t = f0; t < f1; t++) { const x = px(t), h = Math.round((f[t] / p) * (rowH - 6)); for (let y = 0; y < h; y++) put(x, Math.round((b + 1) * rowH) - y, ...bandCol[b]); }
    for (const o of A.bands[b].onsets) { const t = o.t * A.fps; if (t < f0 || t >= f1) continue; const x = px(t); for (let y = -4; y < 0; y++) put(x, Math.round(b * rowH) + 6 + y, 255, 255, 255); }
  }
  { const p = 1.5; for (let t = f0; t < f1; t++) { const x = px(t), h = Math.round((A.odf[t] / p) * (rowH - 6)); for (let y = 0; y < h; y++) put(x, H - 1 - y, 200, 200, 200); } }
  for (let i = 0; i < A.beats.length; i++) { const t = A.beats[i] * A.fps; if (t < f0 || t >= f1) continue; const x = px(t), db = A.downbeat[i]; for (let y = 0; y < H; y += db ? 1 : 3) put(x, y, db ? 255 : 140, db ? 255 : 140, 0); }
  for (const n of A.notes) { const a = n.t0 * A.fps, b = n.t1 * A.fps; if (b < f0 || a >= f1) continue; const y = Math.round(H - 60 - (n.midi - 36) * 4); for (let x = Math.max(0, px(a)); x <= Math.min(W - 1, px(b)); x++) { put(x, y, 255, 255, 255); put(x, y + 1, 255, 255, 255); } }
  const ppm = Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), Buffer.from(img)]);
  fs.writeFileSync(arg('--png') + '.ppm', ppm);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', arg('--png') + '.ppm', arg('--png')]);
  fs.unlinkSync(arg('--png') + '.ppm');
  console.log('png →', arg('--png'), `(${secs}–${secs + span} s)`);
}
function fmt(s) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
