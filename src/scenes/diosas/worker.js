/**
 * Worker que fabrica las mallas pesadas (cabeza, busto, pelo) sin congelar la
 * proyección. Responde { id, result } con arrays transferibles.
 */
import { buildAsset } from './assets.js';

self.onmessage = (e) => {
  const { id, kind, args } = e.data;
  try {
    const result = buildAsset(kind, args);
    const transfer = Object.values(result).filter((v) => v && v.buffer instanceof ArrayBuffer).map((v) => v.buffer);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err) });
  }
};
