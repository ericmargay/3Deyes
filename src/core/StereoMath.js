/**
 * Geometría del estéreo: disposición de las dos imágenes en pantalla y
 * cálculo de distancias de observación a partir de medidas físicas.
 *
 * Unidades: metros para el mundo físico, "unidades de escena" para Three.js.
 */
export const DEG = Math.PI / 180;
export const DEFAULT_IPD = 0.065; // distancia interocular media (m)

export const LIMITS = {
  crossMaxDeg: 15,          // convergencia máxima sostenible mirando bizco
  crossComfortDeg: 8,       // convergencia cómoda
  parallelMaxDivergeDeg: 1, // el ojo casi no puede divergir
  disparityMaxDeg: 1.5,     // diferencia de vergencia máxima entre pared y objeto virtual
  disparityComfortDeg: 1,
  parallelPracticalMaxM: 60, // más lejos que esto lo damos por inviable
};

/** Rectángulos (0..1 de pantalla) de cada ojo para un modo, tamaño y separación. */
export function computeLayout(mode, scale, gap) {
  const s = scale, g = gap;
  let rL, rR;
  if (mode === 'parallel' || mode === 'cross') {
    const halfW = 0.5 - g / 2, w = halfW * s, h = s, y = (1 - h) / 2;
    rL = { x: (halfW - w) / 2, y, w, h };
    rR = { x: 0.5 + g / 2 + (halfW - w) / 2, y, w, h };
  } else if (mode === 'overunder') {
    const halfH = 0.5 - g / 2, w = s, h = halfH * s, x = (1 - w) / 2;
    rL = { x, y: 0.5 + g / 2 + (halfH - h) / 2, w, h };
    rR = { x, y: (halfH - h) / 2, w, h };
  } else {
    const w = s, h = s;
    rL = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    rR = { ...rL };
  }
  return { rL, rR };
}

/**
 * Analiza una configuración.
 * @param o.mode      'mono' | 'parallel' | 'cross' | 'overunder' | 'anaglyph'
 * @param o.scale     stereo.scale
 * @param o.gap       stereo.gap
 * @param o.eyeSep    stereo.eyeSep (unidades de escena)
 * @param o.focus     stereo.focus  (unidades de escena)
 * @param o.fov       fov vertical de la cámara (grados)
 * @param o.screenW   ancho físico de toda la proyección (m)
 * @param o.pxW,pxH   resolución del canvas
 * @param o.ipd       distancia interocular (m)
 * @param o.zNear     distancia del objeto más cercano a la cámara (unidades de escena)
 */
export function analyze(o) {
  const ipd = o.ipd ?? DEFAULT_IPD;
  const zNear = o.zNear ?? o.focus / 2;
  const { rL, rR } = computeLayout(o.mode, o.scale, o.gap);
  const screenH = o.screenW * (o.pxH / o.pxW);
  const mPerPx = o.screenW / o.pxW;
  const imageW = rL.w * o.screenW, imageH = rL.h * screenH;
  const aspect = (rL.w * o.pxW) / (rL.h * o.pxH);
  const sepX = Math.abs((rR.x + rR.w / 2) - (rL.x + rL.w / 2)) * o.screenW;
  const sepY = Math.abs((rR.y + rR.h / 2) - (rL.y + rL.h / 2)) * screenH;

  // ancho visible en el plano de convergencia (unidades de escena)
  const Wf = 2 * o.focus * Math.tan((o.fov * DEG) / 2) * aspect;
  const toM = imageW / Wf;                                  // unidades de escena → metros en la pared
  const parFar = o.eyeSep * toM;                            // paralaje a infinito (detrás de la pared)
  const parNear = o.eyeSep * (1 - o.focus / zNear) * toM;   // paralaje del objeto más cercano (negativo = delante)
  const eyeSepMax = (ipd / toM);                            // para que lo lejano no obligue a divergir

  const tanHalf = (deg) => Math.tan((deg * DEG) / 2);
  const cross = {
    dMin: (ipd + sepX) / (2 * tanHalf(LIMITS.crossMaxDeg)),
    dComfort: (ipd + sepX) / (2 * tanHalf(LIMITS.crossComfortDeg)),
  };
  const parallel = {
    viable: sepX <= ipd,
    dMin: sepX <= ipd ? 0 : (sepX - ipd) / (2 * tanHalf(LIMITS.parallelMaxDivergeDeg)),
  };
  parallel.practical = parallel.viable || parallel.dMin <= LIMITS.parallelPracticalMaxM;
  const disparity = {
    farM: parFar, nearM: parNear, farOk: parFar <= ipd, eyeSepMax,
    dMin: Math.abs(parNear) / Math.tan(LIMITS.disparityMaxDeg * DEG),
    dComfort: Math.abs(parNear) / Math.tan(LIMITS.disparityComfortDeg * DEG),
  };

  // recomendación para el modo actual
  let rec;
  if (o.mode === 'cross') rec = { dMin: Math.max(cross.dMin, disparity.dMin), dComfort: Math.max(cross.dComfort, disparity.dComfort), ok: true, note: 'visión cruzada' };
  else if (o.mode === 'parallel') rec = parallel.practical
    ? { dMin: Math.max(parallel.dMin, disparity.dMin), dComfort: Math.max(parallel.dMin, disparity.dComfort), ok: true, note: parallel.viable ? 'visión paralela' : 'paralela con divergencia' }
    : { dMin: parallel.dMin, dComfort: parallel.dMin, ok: false, note: 'parallel no viable a esta escala' };
  else if (o.mode === 'overunder') rec = { dMin: 0, dComfort: 0, ok: false, note: 'over/under necesita visor' };
  else if (o.mode === 'anaglyph') rec = { dMin: disparity.dMin, dComfort: disparity.dComfort, ok: true, note: 'anaglifo con lentes' };
  else rec = { dMin: 0, dComfort: 0, ok: true, note: 'mono (sin estéreo)' };
  if (!disparity.farOk && rec.ok && (o.mode === 'parallel' || o.mode === 'anaglyph')) rec.note += ' · eyeSep alto: lo lejano hace divergir';

  return { mPerPx, screenH, imageW, imageH, sepX, sepY, Wf, cross, parallel, disparity, rec, rL, rR };
}

export function fmtM(m) { return m >= 100 ? `${Math.round(m)} m` : m >= 10 ? `${m.toFixed(1)} m` : m >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`; }

export function loadCalibration() {
  try { return JSON.parse(localStorage.getItem('3deyes.calib') || 'null'); } catch (_) { return null; }
}
export function saveCalibration(c) {
  try { localStorage.setItem('3deyes.calib', JSON.stringify(c)); } catch (_) { /* */ }
}
