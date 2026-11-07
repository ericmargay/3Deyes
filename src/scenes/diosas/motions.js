/**
 * Biblioteca de movimientos, sacados de los gestos de los videos de referencia
 * (inclinar la cabeza, girar a perfil sin dejar de mirar, alzar la vista,
 * balanceo en trance) más algunos de danza (asentir al beat, deslizamiento de
 * cuello). Todos están escritos en BEATS, así quedan en tempo con Ableton.
 *
 * Cada movimiento recibe:
 *   b  posición en beats (continua)      t  segundos
 *   r  semilla 0..1 de cada figura       o  pose de salida (se suma)
 *
 * Pose: yaw (girar), pitch (+ = alzar el mentón), roll (inclinar), slide
 * (desplazamiento lateral del cuello), lean (acercarse), rise (subir),
 * lids (apertura de párpados, 1 = normal), gazeUp (ojos al cielo 0..1),
 * mouth (labios entreabiertos 0..1).
 */
const TAU = Math.PI * 2;
const ss = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export const POSE_KEYS = ['yaw', 'pitch', 'roll', 'slide', 'lean', 'rise', 'lids', 'gazeUp', 'mouth'];
export function emptyPose(o = {}) { for (const k of POSE_KEYS) o[k] = 0; o.lids = 1; return o; }

/** Recorre una secuencia de poses cambiando cada `every` beats; `trans` = fracción del tramo que dura la transición. */
function sequence(b, every, poses, o, trans = 0.5) {
  const n = poses.length, ph = b / every, i = Math.floor(ph);
  const k = ss((ph - i) / trans);
  const prev = poses[(((i - 1) % n) + n) % n], cur = poses[((i % n) + n) % n];
  for (const key of POSE_KEYS) {
    const a = prev[key] ?? (key === 'lids' ? 1 : 0), c = cur[key] ?? (key === 'lids' ? 1 : 0);
    o[key] = a + (c - a) * k;
  }
}

export const MOTIONS = {
  /** casi quieta: respira y deriva apenas */
  respiracion(b, t, r, o) {
    o.pitch = 0.025 * Math.sin(t * 0.8 + r * 6);
    o.yaw = 0.035 * Math.sin(t * 0.37 + r * 3);
    o.roll = 0.02 * Math.sin(t * 0.5 + r * 9);
  },
  /** balanceo en ocho, párpados caídos (2 compases por ciclo) */
  trance(b, t, r, o) {
    const w = (TAU * b) / 8;
    o.yaw = 0.2 * Math.sin(w);
    o.roll = 0.14 * Math.sin(2 * w + 0.5);
    o.pitch = -0.05 + 0.07 * Math.sin(w + 1.3);
    o.rise = 0.04 * Math.sin(2 * w);
    o.lids = 0.55;
  },
  /** de frente, inmóvil, se acerca muy lento: la mirada fija */
  mirada(b, t, r, o) {
    o.yaw = 0.015 * Math.sin(t * 0.3 + r * 5);
    o.pitch = -0.02;
    o.lean = 0.35 * (0.5 - 0.5 * Math.cos((TAU * b) / 32));
    o.lids = 1.08;
  },
  /** inclina la cabeza hacia un lado y el otro, una pose por compás */
  inclinacion(b, t, r, o) {
    sequence(b, 4, [
      { roll: 0.24, yaw: 0.12, pitch: 0.05 },
      { roll: -0.04, yaw: -0.04, pitch: -0.04, lids: 0.9 },
      { roll: -0.22, yaw: -0.16, pitch: 0.06 },
      { roll: 0.06, yaw: 0.18, pitch: -0.03, lids: 0.85 },
    ], o, 0.6);
  },
  /** alza el rostro al cielo con los ojos en blanco y vuelve a mirarte */
  oraculo(b, t, r, o) {
    sequence(b, 4, [
      { pitch: 0.36, gazeUp: 1, lids: 0.95, mouth: 0.35, roll: 0.05 },
      { pitch: -0.06, gazeUp: 0, lids: 1.05 },
    ], o, 0.55);
  },
  /** gira a tres cuartos sin dejar de mirarte */
  perfil(b, t, r, o) {
    sequence(b, 4, [
      { yaw: 0 },
      { yaw: 0.7, roll: 0.06, pitch: 0.03, lids: 0.9 },
      { yaw: 0 },
      { yaw: -0.7, roll: -0.06, pitch: 0.03, lids: 0.9 },
    ], o, 0.5);
  },
  /** asiente en cada beat, se mece por compás */
  danza(b, t, r, o) {
    const f = b - Math.floor(b);
    const hit = Math.exp(-f * 5) * ss(f * 12);
    o.pitch = -0.09 * hit + 0.02;
    o.roll = 0.09 * Math.sin((TAU * b) / 2);
    o.yaw = 0.12 * Math.sin((TAU * b) / 8);
    o.rise = 0.035 * hit;
  },
  /** deslizamiento lateral del cuello (danzas de la India / Medio Oriente) */
  serpiente(b, t, r, o) {
    const w = (TAU * b) / 2;
    o.slide = 0.13 * Math.sin(w);
    o.roll = -0.04 * Math.sin(w);
    o.yaw = 0.05 * Math.sin((TAU * b) / 8);
    o.lids = 0.8;
  },
};
export const MOTION_NAMES = Object.keys(MOTIONS);
