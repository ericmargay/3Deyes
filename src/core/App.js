import * as THREE from 'three';
import { Params } from './Params.js';
import { StereoOutput, STEREO_MODES } from '../output/StereoOutput.js';
import { CornerPin } from '../output/CornerPin.js';
import { DepthLook } from '../scenes/BaseScene.js';
import { RoomScene } from '../scenes/RoomScene.js';
import { FluidScene } from '../scenes/FluidScene.js';
import { BlobScene } from '../scenes/BlobScene.js';
import { TrackScene } from '../scenes/TrackScene.js';
import { MidiInput } from '../control/Midi.js';
import { SerialInput } from '../control/Serial.js';
import { SocketInput } from '../control/Socket.js';
import { AudioInput } from '../control/Audio.js';
import { Gui } from '../control/Gui.js';
import { analyze, fmtM, loadCalibration } from './StereoMath.js';
import { Project, STORAGE_KEY, applySceneProject } from '../editor/Project.js';
import { TimelinePlayer } from '../editor/Timeline.js';
import { RuleEngine } from '../editor/Rules.js';
import { Gyro } from '../control/Gyro.js';

const SCENES = [RoomScene, FluidScene, BlobScene, TrackScene];

export class App {
  constructor() {
    this.params = new Params();
    this.logLines = [];
    this.events = new EventTarget();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);

    // parámetros globales
    const p = this.params;
    p.define('scene.current', { type: 'option', options: SCENES.map((S) => S.id), default: SCENES[0].id, label: 'escena' });
    p.define('scene.next', { type: 'trigger', label: 'siguiente escena' });
    p.define('look.exposure', { min: 0.1, max: 3, default: 1, step: 0.01, label: 'exposición' });
    p.define('look.pixelRatio', { min: 0.25, max: 2, default: Math.min(window.devicePixelRatio, 2), step: 0.05, label: 'resolución (pixel ratio)' });
    p.define('look.timeScale', { min: 0, max: 3, default: 1, step: 0.01, label: 'velocidad del tiempo' });

    // proyecto del editor: overrides de objetos, línea de tiempo y reglas por escena
    this.project = Project.load();
    this.timeline = new TimelinePlayer(p, { getRoot: () => this.current?.scene, runAction: (a) => this.rules.run(a) });
    this.rules = new RuleEngine(p, { setScene: (n) => this.setScene(n), nextScene: () => this.nextScene(), timeline: this.timeline, log: (m) => this.log(m), getRoot: () => this.current?.scene });
    window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { this.project = Project.load(); this.applyProject(); } });

    this.stereo = new StereoOutput(this.renderer, p);
    this.cornerPin = new CornerPin(this.renderer);
    this.depthLook = new DepthLook(p);

    this.scenes = SCENES.map((S) => new S(this));
    this.current = null;

    // entradas
    const log = (m) => this.log(m);
    this.midi = new MidiInput(p, log);
    this.serial = new SerialInput(p, log);
    this.socket = new SocketInput(p, log);
    this.audio = new AudioInput(p, log);

    this.gui = new Gui(p, {
      'MIDI (Ableton)': () => this.midi.connect(),
      'serial (ESP32)': () => this.serial.connect(),
      'WebSocket / OSC': () => this.socket.connect(),
      'audio (mic / loopback)': () => this.audio.connect(),
      'audio: archivo de música': () => this.audio.pickFile(),
      'reset parámetros': () => p.reset(),
      'reset corner-pin': () => this.cornerPin.reset(),
      'fullscreen': () => this.toggleFullscreen(),
      'calibración (C)': () => window.open('calibrate.html', '_blank'),
      'editor de escenas (E)': () => window.open('editor.html', '_blank'),
      'diseño del estereoscopio': () => window.open('visor.html', '_blank'),
    });
    this.calib = loadCalibration();
    window.addEventListener('focus', () => { this.calib = loadCalibration(); });

    p.load();
    // ?stereo.mode=cross&scene.current=fluid&look.depth=1 → arranque configurado (útil para la instalación)
    for (const [k, v] of new URLSearchParams(location.search)) {
      if (p.has(k)) p.set(k, p.def(k).type === 'boolean' ? v === '1' || v === 'true' : v, 'url');
      else if (k.includes('.')) p.pending[k] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);
    }
    p.onChange((id, value, source) => {
      if (id === 'scene.current') this.setScene(value);
      if (id === 'scene.next') this.nextScene();
      if (id === 'look.pixelRatio') { this.renderer.setPixelRatio(value); this.resize(); }
      if (source !== 'restore') this.scheduleSave();
    });

    this.hud = document.getElementById('hud');
    this.help = document.getElementById('help');
    this.gyro = new Gyro((yaw, pitch) => this.current?.onLook?.(yaw, pitch), (m) => this.log(m));
    this.setupMobile();
    this.clock = new THREE.Clock();
    this.time = 0;
    this.fps = 0; this.frames = 0; this.fpsT = 0;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    // puntero → escena actual (mirar alrededor, activar objetos)
    const norm = (e) => [(e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1];
    this.renderer.domElement.addEventListener('pointermove', (e) => { const [x, y] = norm(e); this.current?.onPointerMove?.(x, y); });
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      const [x, y] = norm(e); this.current?.onPointerDown?.(x, y);
      const obj = this.pick(x, y);
      this.emit('click', { x, y, object: obj, path: obj ? pathOfObject(obj, this.current.scene) : null });
    });
    this.midi.connect().catch(() => {});
    this.setScene(p.get('scene.current'));
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  log(msg) {
    this.logLines.push(msg);
    if (this.logLines.length > 4) this.logLines.shift();
    console.log('[3Deyes]', msg);
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.params.save(), 500);
  }

  setScene(name) {
    const next = this.scenes.find((s) => s.key === name) ?? this.scenes[0];
    if (this.current === next) return;
    this.current?.exit();
    this.current = next;
    this.current.enter();
    this.params.set('scene.current', next.key, 'app');
    this.resize();
    this.applyProject();
    this.emit('enter', { scene: next.key });
  }

  /** Emite un evento (para las reglas de interacción y para quien escuche). */
  emit(type, detail = {}) {
    this.events.dispatchEvent(new CustomEvent(type, { detail }));
    this.rules?.handle(type, detail);
  }

  /** Aplica al la escena actual lo que el editor guardó: overrides, reglas y línea de tiempo. */
  applyProject() {
    if (!this.current) return;
    const ps = this.project.scene(this.current.key);
    applySceneProject(this.current.scene, ps, this.project.data.assets);
    this.rules.load(ps.rules);
    this.timeline.load(ps.timeline, true);
  }

  /** Objeto de la escena bajo el puntero (cámara de la escena). */
  pick(x, y) {
    const scene = this.current; if (!scene) return null;
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    ray.params.Line.threshold = 0.2; ray.params.Points.threshold = 0.2;
    ray.setFromCamera(new THREE.Vector2(x, y), scene.camera);
    const hits = ray.intersectObjects(scene.scene.children, true).filter((h) => h.object.visible && !h.object.userData.helper);
    return hits[0]?.object ?? null;
  }

  nextScene() {
    const i = (this.scenes.indexOf(this.current) + 1) % this.scenes.length;
    this.setScene(this.scenes[i].key);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.cornerPin.ensureSize(Math.round(w * pr), Math.round(h * pr));
    this.cornerPin.positionHandles();
  }

  onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    this.emit('key', { key: e.key });
    if (k === 'e') { window.open('editor.html', '_blank'); return; }
    if (k >= '1' && k <= '9') { const s = this.scenes[Number(k) - 1]; if (s) this.setScene(s.key); }
    else if (k === 'm') this.stereo.nextMode();
    else if (k === 's') this.params.set('stereo.swap', !this.params.get('stereo.swap'));
    else if (k === 'g') this.gui.toggle();
    else if (k === 'h') { this.help.classList.toggle('hidden'); this.hud.classList.toggle('hidden'); }
    else if (k === 'p') this.cornerPin.setEdit(!this.cornerPin.edit);
    else if (k === 'f') this.toggleFullscreen();
    else if (k === 'r') this.params.reset(this.current.key);
    else if (k === 'd') this.params.set('look.depth', !this.params.get('look.depth'));
    else if (k === 'c') window.open('calibrate.html', '_blank');
    else if (k === ' ') this.nextScene();
    else if (k === 'arrowleft' || k === 'arrowright') {
      const d = this.params.def('stereo.eyeSep');
      this.params.set('stereo.eyeSep', d.value + (k === 'arrowright' ? 0.01 : -0.01) * (e.shiftKey ? 5 : 1));
    } else if (k === 'arrowup' || k === 'arrowdown') {
      const d = this.params.def('stereo.focus');
      this.params.set('stereo.focus', d.value + (k === 'arrowup' ? 0.25 : -0.25) * (e.shiftKey ? 4 : 1));
    }
  }

  /** Teléfono detectado: ofrece el modo visor VR (pantalla partida bajo las lentes + giroscopio). */
  setupMobile() {
    const ua = navigator.userAgent;
    this.kiosk = new URLSearchParams(location.search).get('vr') === '1';
    this.isMobile = this.kiosk || /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) < 900);
    const prompt = document.getElementById('vrPrompt');
    if (!prompt) return;
    if (!this.isMobile) { prompt.remove(); return; }
    prompt.classList.remove('hidden');
    this.setupTouch();
    if (this.kiosk) {
      // app iOS: sin GUI ni HUD; el toque inicial habilita giroscopio y audio
      this.gui.gui.hide(); this.hud.classList.add('hidden'); this.help.classList.add('hidden');
      prompt.querySelector('.card').innerHTML = '<h2>3Deyes · visor</h2>Colocá el teléfono en horizontal y tocá para iniciar. Después ponelo en el visor.<br><button id="vrEnter" class="primary" style="width:100%;margin-top:12px">Tocar para iniciar</button>';
      document.getElementById('vrEnter').onclick = () => this.enterVr();
      document.getElementById('vrBar')?.remove();
      return;
    }
    document.getElementById('vrEnter').onclick = () => this.enterVr();
    document.getElementById('vrSkip').onclick = () => { prompt.classList.add('hidden'); };
    document.getElementById('vrExit').onclick = () => this.exitVr();
    document.getElementById('vrRecenter').onclick = () => this.gyro.recenter();
    const tip = () => document.getElementById('vrTip')?.classList.toggle('hidden', window.innerWidth > window.innerHeight);
    window.addEventListener('resize', tip); tip();
  }

  /** Gestos táctiles en modo visor: pellizco = zoom (tamaño de imagen, igual para ambos ojos). */
  setupTouch() {
    const el = this.renderer.domElement;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let d0 = null, s0 = 1;
    el.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = dist(e.touches); s0 = this.params.get('stereo.vrImageScale'); } }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      if (this.params.get('stereo.mode') === 'vr') this.setZoom(s0 * (dist(e.touches) / d0));
    }, { passive: false });
    el.addEventListener('touchend', () => { d0 = null; });
  }

  /** Zoom del visor: 0.4 … 1 (fracción de la mitad de pantalla que ocupa cada ojo). Lo usa la app iOS. */
  setZoom(v) { this.params.set('stereo.vrImageScale', Math.min(1, Math.max(0.4, v))); }

  async enterVr() {
    document.getElementById('vrPrompt')?.classList.add('hidden');
    this.params.set('stereo.mode', 'vr');
    this.gui.gui.hide(); this.hud.classList.add('hidden'); this.help.classList.add('hidden');
    if (!this.kiosk) document.getElementById('vrBar')?.classList.remove('hidden');
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (_) { /* iOS no lo permite */ }
    try { await screen.orientation?.lock?.('landscape'); } catch (_) { /* no soportado: el usuario gira el teléfono */ }
    await this.gyro.enable();
    this.vr = true;
  }

  exitVr() {
    this.vr = false; this.gyro.disable();
    document.getElementById('vrBar')?.classList.add('hidden');
    this.hud.classList.remove('hidden'); this.gui.gui.show();
    this.params.set('stereo.mode', 'mono');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1) * this.params.get('look.timeScale');
    this.time += dt;
    this.audio.update(dt);
    if (this.audio.beat) this.emit('beat', {});
    const scene = this.current;
    scene.update(dt, this.time);
    this.timeline.update(dt);
    this.rules.update(dt);
    this.renderer.toneMappingExposure = this.params.get('look.exposure');

    if (!scene.handlesDepthLook) this.depthLook.apply(scene.scene, scene.camera);

    const target = this.cornerPin.active ? this.cornerPin.rt : null;
    this.stereo.render(scene.scene, scene.camera, target);
    if (target) this.cornerPin.render();

    this.updateHud(dt);
  }

  updateHud(dt) {
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    const p = this.params;
    const learn = p.learnTarget ? `\nLEARN → ${p.learnTarget}  (mové un control)` : '';
    const dist = this.distanceLine();
    this.hud.textContent =
      `${this.current.title}   ${p.get('stereo.mode')}${p.get('stereo.swap') ? ' (swap)' : ''}   ` +
      `eyeSep ${p.get('stereo.eyeSep').toFixed(3)}  focus ${p.get('stereo.focus').toFixed(2)}   ${this.fps} fps` +
      (p.get('look.depth') ? '   [depth]' : '') + (this.cornerPin.edit ? '   [corner-pin]' : '') +
      dist + learn + (this.logLines.length ? '\n' + this.logLines.join('\n') : '');
  }

  /** Distancia recomendada del público según la calibración guardada (página /calibrate.html). */
  distanceLine() {
    const c = this.calib;
    if (!c) return '\n[C] calibrar proyección para ver la distancia del público';
    const p = this.params, size = this.renderer.getSize(new THREE.Vector2()), pr = this.renderer.getPixelRatio();
    const a = analyze({
      mode: p.get('stereo.mode'), scale: p.get('stereo.scale'), gap: p.get('stereo.gap'),
      eyeSep: p.get('stereo.eyeSep'), focus: p.get('stereo.focus'), fov: this.current.camera.fov,
      screenW: c.screenW, pxW: size.x * pr, pxH: size.y * pr, ipd: c.ipd, zNear: c.zNear,
    });
    const r = a.rec;
    return r.ok
      ? `\npúblico desde ${fmtM(r.dMin)} (cómodo ${fmtM(r.dComfort)}) · ${r.note} · eyeSep máx ${a.disparity.eyeSepMax.toFixed(3)}`
      : `\n${r.note}`;
  }
}

function pathOfObject(obj, root) {
  const parts = []; let o = obj;
  while (o && o !== root) { parts.unshift(o.name || o.type); o = o.parent; }
  return parts.join('/');
}

export { STEREO_MODES };
