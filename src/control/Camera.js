/**
 * Cámara web como sensor de presencia y posición (sin librerías): compara
 * cada cuadro con el anterior en baja resolución y sigue el centro del
 * movimiento. Sirve para que las diosas miren a quien pasa frente al mural.
 *
 * Fuentes publicadas (asignables con learn a cualquier parámetro):
 *   cam:x         -1..1 → 0..1  posición horizontal del movimiento
 *   cam:y         -1..1 → 0..1  posición vertical
 *   cam:motion    cantidad de movimiento en el cuadro
 *   cam:presence  1 si hubo alguien en los últimos segundos, decae a 0
 *
 * En la escena Diosas: mirada.modo = "cámara" la usa directo.
 * Para sensores externos (ESP32 con ToF / PIR, Kinect, MediaPipe vía OSC)
 * mandar diosas.mirada.x / diosas.mirada.y / diosas.mirada.presencia.
 */
export class CameraInput {
  constructor(params, log = console.log) {
    this.params = params;
    this.log = log;
    this.active = false;
    this.x = 0; this.y = 0; this.motion = 0; this.presence = 0;
    this.W = 64; this.H = 48;
    params.define('cam.sensibilidad', { min: 0, max: 1, default: 0.5, step: 0.01, label: 'sensibilidad' });
    params.define('cam.espejo', { default: true, label: 'espejo (la cámara mira al público)' });
    params.define('cam.memoria', { min: 0.5, max: 20, default: 4, step: 0.1, label: 'presencia: segundos de memoria' });
    params.define('cam.suavizado', { min: 0, max: 0.98, default: 0.8, step: 0.01, label: 'suavizado' });
  }

  async connect() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
      this.video = document.createElement('video');
      this.video.srcObject = stream; this.video.muted = true; this.video.playsInline = true;
      await this.video.play();
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.W; this.canvas.height = this.H;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.prev = new Float32Array(this.W * this.H);
      this.active = true;
      this.log('Cámara conectada (sensor de presencia)');
      return true;
    } catch (e) { this.log(`Cámara: ${e.message}`); return false; }
  }

  update(dt) {
    if (!this.active || this.video.readyState < 2) return;
    const { W, H } = this;
    this.ctx.drawImage(this.video, 0, 0, W, H);
    const px = this.ctx.getImageData(0, 0, W, H).data;
    const thr = 60 - 50 * this.params.get('cam.sensibilidad');
    let sx = 0, sy = 0, n = 0;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const g = px[j] * 0.3 + px[j + 1] * 0.59 + px[j + 2] * 0.11;
      if (Math.abs(g - this.prev[i]) > thr) { sx += i % W; sy += (i / W) | 0; n++; }
      this.prev[i] = g;
    }
    const frac = n / (W * H);
    this.motion = this.motion * 0.8 + frac * 0.2;
    const k = this.params.get('cam.suavizado');
    if (n > W * H * 0.004) {
      let x = (sx / n / W) * 2 - 1;
      if (this.params.get('cam.espejo')) x = -x;
      const y = -((sy / n / H) * 2 - 1);
      this.x = this.x * k + x * (1 - k);
      this.y = this.y * k + y * (1 - k);
      this.presence = 1;
    } else {
      this.presence = Math.max(0, this.presence - dt / this.params.get('cam.memoria'));
    }
    const p = this.params;
    p.feed('cam:x', this.x * 0.5 + 0.5, 'cam');
    p.feed('cam:y', this.y * 0.5 + 0.5, 'cam');
    p.feed('cam:motion', Math.min(1, this.motion * 20), 'cam');
    p.feed('cam:presence', this.presence, 'cam');
  }
}
