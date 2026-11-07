/** Worker: analiza el tema entero sin congelar la proyección. */
import { analyze } from './analysis.js';

self.onmessage = (e) => {
  const { id, pcm, sr } = e.data;
  try {
    let last = 0;
    const A = analyze(pcm, sr, (p, msg) => { const now = performance.now(); if (now - last > 80 || p >= 1) { last = now; self.postMessage({ id, progress: p, msg }); } });
    const transfer = [];
    const collect = (o) => { for (const v of Object.values(o)) { if (v && ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (Array.isArray(v)) v.forEach((x) => x && typeof x === 'object' && !ArrayBuffer.isView(x) && collect(x)); } };
    collect(A);
    self.postMessage({ id, result: A }, [...new Set(transfer)]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err) });
  }
};
