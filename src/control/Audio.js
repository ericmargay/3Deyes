/**
 * Análisis de audio (micrófono o entrada de línea / loopback desde Ableton con
 * BlackHole o Loopback). Publica niveles como fuentes asignables con "learn":
 *
 *   audio:level   volumen general (RMS)
 *   audio:bass    graves  (< 200 Hz)
 *   audio:mid     medios  (200 Hz – 2 kHz)
 *   audio:high    agudos  (> 2 kHz)
 *   audio:beat    1 durante un golpe detectado, luego 0
 *
 * Doble clic en un parámetro de la GUI y hacer ruido → queda ligado al audio.
 */
export class AudioInput {
  constructor(params, log = console.log) {
    this.params = params;
    this.log = log;
    this.ctx = null;
    this.analyser = null;
    this.data = null;
    this.smooth = { level: 0, bass: 0, mid: 0, high: 0 };
    this.beatAvg = 0;
    this.beatCooldown = 0;
    this.gain = 1;
    this.beat = false;     // true solo en el frame en que se detecta un golpe
    this.active = false;
    this.element = null;
    params.define('audio.gain', { min: 0, max: 8, default: 2, step: 0.01, label: 'ganancia' });
    params.define('audio.smoothing', { min: 0, max: 0.98, default: 0.6, step: 0.01, label: 'suavizado' });
    params.define('audio.beatSens', { min: 1, max: 3, default: 1.5, step: 0.01, label: 'sensibilidad beat' });
  }

  async connect() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.5;
      src.connect(this.analyser);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this.active = true;
      this.log('Audio conectado');
      return true;
    } catch (e) { this.log(`Audio: ${e.message}`); return false; }
  }

  /** Reproduce un archivo de audio (mp3/wav) en loop y lo analiza. */
  async playFile(file) {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      await this.ctx.resume();
      if (!this.analyser) {
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.5;
        this.data = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if (this.element) { this.element.pause(); this.element.src = ''; }
      const el = new Audio(URL.createObjectURL(file));
      el.loop = true; el.crossOrigin = 'anonymous';
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      await el.play();
      this.element = el;
      this.active = true;
      this.log(`Audio: ${file.name}`);
      return true;
    } catch (e) { this.log(`Audio: ${e.message}`); return false; }
  }

  /** Abre un selector de archivo (necesita un gesto del usuario). */
  pickFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'audio/*';
    input.onchange = () => { if (input.files[0]) this.playFile(input.files[0]); };
    input.click();
  }

  update(dt) {
    this.beat = false;
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.data);
    const nyq = this.ctx.sampleRate / 2, n = this.data.length;
    const bin = (hz) => Math.min(n - 1, Math.round((hz / nyq) * n));
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += this.data[i]; return (s / Math.max(1, b - a)) / 255; };
    const g = this.params.get('audio.gain');
    const raw = {
      bass: avg(bin(20), bin(200)) * g,
      mid: avg(bin(200), bin(2000)) * g,
      high: avg(bin(2000), bin(12000)) * g,
    };
    raw.level = (raw.bass + raw.mid + raw.high) / 3;
    const k = this.params.get('audio.smoothing');
    for (const key of Object.keys(raw)) {
      const v = Math.min(1, raw[key]);
      this.smooth[key] = this.smooth[key] * k + v * (1 - k);
      this.params.feed(`audio:${key}`, this.smooth[key], 'audio');
    }
    // beat: los graves superan claramente su promedio reciente
    this.beatAvg = this.beatAvg * 0.95 + raw.bass * 0.05;
    this.beatCooldown -= dt;
    const isBeat = raw.bass > this.beatAvg * this.params.get('audio.beatSens') && raw.bass > 0.1 && this.beatCooldown <= 0;
    if (isBeat) this.beatCooldown = 0.18;
    this.beat = isBeat;
    this.params.feed('audio:beat', isBeat ? 1 : 0, 'audio');
  }
}
