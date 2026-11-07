/**
 * Herramientas de señal (JS puro, sin three): FFT radix-2, ventana de Hann,
 * STFT por cuadros, selección de picos con umbral adaptativo, estadísticas.
 * Las usan el análisis offline (worker) y el analizador en vivo.
 */

/** FFT real → magnitudes. Devuelve una función fft(re, im) in-place para N potencia de 2. */
export function makeFFT(N) {
  const bits = Math.log2(N) | 0;
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = Math.sin((2 * Math.PI * i) / N); }
  return function fft(re, im) {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const a = start + k, b = a + half;
          const tr = re[b] * cos[w] + im[b] * sin[w], ti = -re[b] * sin[w] + im[b] * cos[w];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

export function hann(N) { const w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); return w; }

/**
 * Analizador por cuadros: cada llamada a frame(center) llena `mag` con las
 * magnitudes (N/2 bins) de la ventana centrada en esa muestra.
 */
export class Spectrum {
  constructor(N) {
    this.N = N; this.half = N / 2;
    this.fft = makeFFT(N); this.win = hann(N);
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.mag = new Float32Array(this.half);
  }
  frame(pcm, center) {
    const { N, re, im, win, mag, half } = this;
    const start = center - half, L = pcm.length;
    for (let i = 0; i < N; i++) { const s = start + i; re[i] = s >= 0 && s < L ? pcm[s] * win[i] : 0; im[i] = 0; }
    this.fft(re, im);
    for (let k = 0; k < half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    return mag;
  }
}

/** Percentil aproximado (submuestrea arrays grandes). */
export function percentile(arr, q) {
  if (!arr.length) return 0;
  const step = Math.max(1, Math.floor(arr.length / 20000)), s = [];
  for (let i = 0; i < arr.length; i += step) s.push(arr[i]);
  s.sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

export function mean(arr, a = 0, b = arr.length) { a = Math.max(0, a); b = Math.min(arr.length, b); if (b <= a) return 0; let s = 0; for (let i = a; i < b; i++) s += arr[i]; return s / (b - a); }

/** Suma acumulada (para medias móviles en O(1)). */
export function cumsum(arr) { const c = new Float64Array(arr.length + 1); for (let i = 0; i < arr.length; i++) c[i + 1] = c[i] + arr[i]; return c; }

/**
 * Picos de una función de novedad con umbral adaptativo (estilo Böck):
 *  - máximo local en ±wMax cuadros
 *  - supera media móvil [n-wPre, n+wPost] · k + delta
 *  - separados al menos `gap` cuadros (se queda el más alto)
 * Devuelve [{ i, v, s }]: índice, valor y fuerza (valor - media local).
 */
export function pickPeaks(x, { wMax = 3, wPre = 10, wPost = 3, k = 1, delta = 0.05, gap = 3, floor = 0 } = {}) {
  const n = x.length, cs = cumsum(x), out = [];
  const avg = (a, b) => { a = Math.max(0, a); b = Math.min(n, b); return b > a ? (cs[b] - cs[a]) / (b - a) : 0; };
  for (let i = 1; i < n - 1; i++) {
    const v = x[i];
    if (v < floor) continue;
    let isMax = true;
    for (let j = Math.max(0, i - wMax), e = Math.min(n - 1, i + wMax); j <= e; j++) if (x[j] > v) { isMax = false; break; }
    if (!isMax) continue;
    const m = avg(i - wPre, i + wPost + 1);
    if (v < m * k + delta) continue;
    const s = v - m, last = out[out.length - 1];
    if (last && i - last.i < gap) { if (v > last.v) { last.i = i; last.v = v; last.s = s; } }
    else out.push({ i, v, s });
  }
  return out;
}

/** Suavizado gaussiano simple (sigma en muestras). */
export function smooth(x, sigma) {
  const r = Math.ceil(sigma * 3), w = new Float64Array(2 * r + 1); let ws = 0;
  for (let i = -r; i <= r; i++) { w[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); ws += w[i + r]; }
  const n = x.length, y = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = -r; j <= r; j++) { const k = i + j; if (k >= 0 && k < n) s += x[k] * w[j + r]; } y[i] = s / ws; }
  return y;
}

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
