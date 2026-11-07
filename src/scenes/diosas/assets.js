/**
 * Fabricación de assets procedurales (mallas y pelo) — corre en el worker o,
 * si no hay workers, en el hilo principal. Cachea por clave.
 */
import { headSDF, bodySDF, headMasks, bodyMasks, HEAD_BOUNDS, BODY_BOUNDS } from './anatomy.js';
import { meshImplicit } from './mesher.js';
import { growHair } from './hair.js';

export const QUALITY = { baja: { cell: 0.026, hair: 0.55 }, media: { cell: 0.018, hair: 0.85 }, alta: { cell: 0.0125, hair: 1.2 } };

export function buildAsset(kind, args = {}) {
  const q = QUALITY[args.quality] || QUALITY.media;
  if (kind === 'head') return meshImplicit((x, y, z) => headSDF(x, y, z), HEAD_BOUNDS, q.cell, { masks: headMasks });
  if (kind === 'body') return meshImplicit(bodySDF, BODY_BOUNDS, q.cell * 1.5, { masks: bodyMasks });
  if (kind === 'hair') return growHair(args.style, q.hair * (args.density ?? 1), args.seed ?? 1);
  throw new Error(`asset desconocido: ${kind}`);
}

// ---------- cliente ----------
const cache = new Map();
let worker = null, nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
    };
    worker.onerror = (e) => { console.warn('[diosas] worker falló, mallando en el hilo principal', e.message); worker = false; for (const [, p] of pending) p.fallback(); pending.clear(); };
  } catch (_) { worker = false; }
  return worker;
}

/** Pide un asset; devuelve una promesa. Se cachea por (kind, args). */
export function requestAsset(kind, args = {}) {
  const key = `${kind}:${JSON.stringify(args)}`;
  if (cache.has(key)) return cache.get(key);
  const sync = () => new Promise((res) => setTimeout(() => res(buildAsset(kind, args)), 0));
  const w = getWorker();
  const prom = w
    ? new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject, fallback: () => sync().then(resolve, reject) }); w.postMessage({ id, kind, args }); })
    : sync();
  cache.set(key, prom);
  prom.catch(() => cache.delete(key));
  return prom;
}
