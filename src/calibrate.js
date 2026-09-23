import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Params } from './core/Params.js';
import { Gui } from './control/Gui.js';
import { MidiInput } from './control/Midi.js';
import { SerialInput } from './control/Serial.js';
import { SocketInput } from './control/Socket.js';
import { AudioInput } from './control/Audio.js';
import { StereoOutput } from './output/StereoOutput.js';
import { DepthLook } from './scenes/BaseScene.js';
import { RoomScene } from './scenes/RoomScene.js';
import { FluidScene } from './scenes/FluidScene.js';
import { BlobScene } from './scenes/BlobScene.js';
import { TrackScene } from './scenes/TrackScene.js';
import { analyze, fmtM, loadCalibration, saveCalibration, LIMITS, DEG } from './core/StereoMath.js';
import { Stage } from './calib/Stage.js';
import { ShaderToy } from './calib/ShaderToy.js';
import { PatternScene } from './calib/PatternScene.js';
import { PRESETS, PRESET_NAMES } from './calib/presets.js';

/**
 * Calibración 3D: el mural a escala real dentro de una nave, con el público
 * a la distancia calculada. Todo pasa por el bus de parámetros, así que se
 * puede modular desde la GUI, MIDI, serial (ESP32) u OSC.
 */
const BAR_FRACTION = 0.5;
const $ = (id) => document.getElementById(id);
const params = new Params();

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer({ element: $('labels') });
labelRenderer.setSize(window.innerWidth, window.innerHeight);

// ---------- parámetros ----------
const calib = loadCalibration();
params.define('medidas.barraCm', { min: 10, max: 3000, default: calib ? calib.screenW * BAR_FRACTION * 100 : 300, step: 0.5, label: 'barra roja medida (cm)' });
params.define('medidas.ipdMm', { min: 50, max: 80, default: calib ? calib.ipd * 1000 : 65, step: 0.5, label: 'distancia interocular (mm)' });
params.define('medidas.pxW', { min: 640, max: 7680, default: calib?.pxW || 1920, step: 1, label: 'proyector px ancho' });
params.define('medidas.pxH', { min: 360, max: 4320, default: calib?.pxH || 1080, step: 1, label: 'proyector px alto' });
params.define('medidas.bottom', { min: 0, max: 10, default: 0.5, step: 0.01, label: 'borde inferior sobre el piso (m)' });
params.define('medidas.fov', { min: 10, max: 120, default: calib?.fov || 45, step: 0.5, label: 'fov vertical escena (°)' });
params.define('medidas.zNear', { min: 0.1, max: 60, default: calib?.zNear || 5, step: 0.1, label: 'objeto más cercano (z)' });

params.define('publico.distancia', { min: 0.5, max: 80, default: 12, step: 0.1, label: 'distancia del público (m)' });
params.define('publico.auto', { default: true, label: 'auto = distancia cómoda' });
params.define('publico.alturaOjos', { min: 0.8, max: 2.2, default: 1.6, step: 0.01, label: 'altura de ojos (m)' });
params.define('publico.altura', { min: 1, max: 2.2, default: 1.75, step: 0.01, label: 'altura persona (m)' });

const stereo = new StereoOutput(renderer, params);
params.set('stereo.mode', 'cross');

params.define('contenido.tipo', { type: 'option', options: ['shader', 'patron', 'escena'], default: 'shader', label: 'contenido del mural' });
params.define('contenido.preset', { type: 'option', options: PRESET_NAMES, default: 'ripple', label: 'shader' });
params.define('contenido.escena', { type: 'option', options: ['room', 'fluid', 'blob', 'track'], default: 'fluid', label: 'escena de la app' });
params.define('contenido.velocidad', { min: 0, max: 4, default: 1, step: 0.01, label: 'velocidad' });
params.define('contenido.relieve', { min: 0, max: 1.5, default: 0.3, step: 0.01, label: 'relieve (m)' });
params.define('contenido.relieveDe', { type: 'option', options: ['alpha', 'luminancia', 'plano'], default: 'alpha', label: 'relieve desde' });
params.define('contenido.brillo', { min: 0, max: 4, default: 1.6, step: 0.01, label: 'brillo' });
params.define('contenido.ao', { min: 0, max: 1, default: 0.6, step: 0.01, label: 'oclusión' });
params.define('contenido.sombreado', { min: 0, max: 1, default: 0.6, step: 0.01, label: 'sombreado relieve' });

params.define('escenario.luzMural', { min: 0, max: 30, default: 6, step: 0.1, label: 'luz que emite el mural' });
params.define('escenario.luzNave', { min: 0, max: 400, default: 120, step: 1, label: 'luz de la nave' });
params.define('escenario.reflejo', { min: 0, max: 1, default: 0.28, step: 0.01, label: 'reflejo del piso' });
params.define('escenario.niebla', { min: 0, max: 0.05, default: 0.008, step: 0.0005, label: 'niebla' });
params.define('escenario.exposicion', { min: 0.2, max: 3, default: 1, step: 0.01, label: 'exposición' });
params.define('escenario.persona', { default: true, label: 'silueta' });
params.define('escenario.fantasmas', { default: true, label: 'siluetas en dMin / cómoda' });
params.define('escenario.zonas', { default: true, label: 'zonas en el piso' });
params.define('escenario.vergencia', { default: true, label: 'geometría de vergencia' });
params.define('camara.vista', { type: 'option', options: ['general', 'publico', 'lateral', 'cenital'], default: 'general', label: 'vista' });
params.define('camara.fovPublico', { min: 30, max: 110, default: 60, step: 1, label: 'fov vista público' });

params.load('3deyes.calibpage');
params.loadGroups('3deyes.params', ['stereo', 'room', 'fluid', 'blob', 'track', 'look']);
for (const [k, v] of new URLSearchParams(location.search)) {
  if (params.has(k)) params.set(k, params.def(k).type === 'boolean' ? v === '1' || v === 'true' : v, 'url');
  else if (k.includes('.')) params.pending[k] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);
}

// ---------- contenido del mural ----------
const wallRT = new THREE.WebGLRenderTarget(1920, 1080, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType });
const shaderToy = new ShaderToy(renderer);
const pattern = new PatternScene();
const depthLook = new DepthLook(params);
const fakeApp = { renderer, params, emit: () => {} };
const appScenes = { room: new RoomScene(fakeApp), fluid: new FluidScene(fakeApp), blob: new BlobScene(fakeApp), track: new TrackScene(fakeApp) };

let shaderSrc = localStorage.getItem('3deyes.shader') || PRESETS.ripple;
function compile(src) {
  const err = shaderToy.setSource(src);
  $('err').textContent = err || '';
  if (!err) { shaderSrc = src; localStorage.setItem('3deyes.shader', src); }
  return err;
}
if (compile(shaderSrc)) compile(PRESETS.ripple);

// ---------- escenario ----------
const stage = new Stage(wallRT.texture);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.01; controls.minDistance = 1;

// ---------- GUI ----------
const log = (m) => console.log('[calib]', m);
const midi = new MidiInput(params, log), serial = new SerialInput(params, log), socket = new SocketInput(params, log), audio = new AudioInput(params, log);
const gui = new Gui(params, {
  'guardar calibración': () => save(),
  'aplicar estéreo y escenas a la app': () => { params.mergeInto('3deyes.params', ['stereo', 'room', 'fluid', 'blob', 'track', 'look']); flash('aplicado a la app'); },
  'usar eyeSep máximo': () => { const { a } = recompute(); params.set('stereo.eyeSep', Math.floor(a.disparity.eyeSepMax * 1000) / 1000); },
  'editor de shader (E)': () => toggleEditor(),
  'abrir la app': () => window.open('/', '_blank'),
  'MIDI (Ableton)': () => midi.connect(),
  'serial (ESP32)': () => serial.connect(),
  'WebSocket / OSC': () => socket.connect(),
  'audio (mic)': () => audio.connect(),
}, ['medidas', 'publico', 'stereo'], '3Deyes · calibración');
midi.connect().catch(() => {});

// ---------- editor ----------
const presetSel = $('presetSel');
for (const n of PRESET_NAMES) { const o = document.createElement('option'); o.value = n; o.textContent = n; presetSel.appendChild(o); }
presetSel.onchange = () => { $('src').value = PRESETS[presetSel.value]; };
$('src').value = shaderSrc;
$('compile').onclick = () => compile($('src').value);
$('closeEditor').onclick = () => toggleEditor(false);
$('src').addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.value = t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 4; } if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') compile(t_val()); });
const t_val = () => $('src').value;
function toggleEditor(force) { const on = force ?? !$('editor').classList.contains('open'); $('editor').classList.toggle('open', on); }

// ---------- cálculo ----------
function readConfig() {
  const screenW = (params.get('medidas.barraCm') / 100) / BAR_FRACTION;
  return {
    mode: params.get('stereo.mode'), scale: params.get('stereo.scale'), gap: params.get('stereo.gap'),
    eyeSep: params.get('stereo.eyeSep'), focus: params.get('stereo.focus'), fov: params.get('medidas.fov'),
    zNear: params.get('medidas.zNear'), ipd: params.get('medidas.ipdMm') / 1000,
    screenW, pxW: params.get('medidas.pxW'), pxH: params.get('medidas.pxH'),
    bottom: params.get('medidas.bottom'), viewerD: params.get('publico.distancia'),
    eyeH: params.get('publico.alturaOjos'), personH: params.get('publico.altura'),
  };
}
function stageSettings() {
  return {
    wallLight: params.get('escenario.luzMural'), hallLight: params.get('escenario.luzNave'), reflection: params.get('escenario.reflejo'),
    fog: params.get('escenario.niebla'), person: params.get('escenario.persona'), ghosts: params.get('escenario.fantasmas'),
    zones: params.get('escenario.zonas'), vergence: params.get('escenario.vergencia'),
    pov: params.get('camara.vista') === 'publico',
  };
}
let last = null;
function recompute() {
  const o = readConfig();
  const a = analyze(o);
  if (params.get('publico.auto') && a.rec.ok && Math.abs(params.get('publico.distancia') - a.rec.dComfort) > 0.05) {
    params.set('publico.distancia', Math.min(80, Math.max(0.5, a.rec.dComfort)), 'auto');
    o.viewerD = params.get('publico.distancia');
  }
  stage.update(a, o, stageSettings());
  report(o, a);
  last = { o, a };
  return last;
}

function report(o, a) {
  const D = o.viewerD, ipd = o.ipd;
  const two = o.mode === 'parallel' || o.mode === 'cross';
  const sep = two ? a.sepX : 0;
  const convDeg = o.mode === 'cross' ? 2 * Math.atan((ipd + sep) / (2 * D)) / DEG : o.mode === 'parallel' && sep > ipd ? -2 * Math.atan((sep - ipd) / (2 * D)) / DEG : 2 * Math.atan(ipd / (2 * D)) / DEG;
  const dNear = Math.abs(a.disparity.nearM) / D / DEG, dFar = a.disparity.farM / D / DEG;
  let verdict, cls;
  const note = a.rec.note.split(' · ')[0];
  if (!a.rec.ok) { verdict = note; cls = 'bad'; }
  else if (D < a.rec.dMin) { verdict = `demasiado cerca: mínimo ${fmtM(a.rec.dMin)}`; cls = 'bad'; }
  else if (D < a.rec.dComfort) { verdict = `funciona, pero es más cómodo desde ${fmtM(a.rec.dComfort)}`; cls = 'warn'; }
  else { verdict = `cómodo · ${note}`; cls = ''; }
  const farMatters = o.mode === 'parallel' || o.mode === 'anaglyph';
  if (!a.disparity.farOk && farMatters) { verdict += ` · eyeSep alto: bajar a ≤ ${a.disparity.eyeSepMax.toFixed(3)}`; cls = cls || 'warn'; }
  const row = (k, v) => `<span>${k}</span><b>${v}</b>`;
  $('report').innerHTML = `<h1>Calibración · ${o.mode}</h1><div class="grid">` + [
    row('proyección', `${fmtM(o.screenW)} × ${fmtM(a.screenH)} · ${(a.mPerPx * 1000).toFixed(2)} mm/px`),
    row('imagen por ojo', `${fmtM(a.imageW)} × ${fmtM(a.imageH)}`),
    row('separación de centros', fmtM(a.sepX)),
    row('público a', `${fmtM(D)} · ojos a ${fmtM(o.eyeH)}`),
    row('convergencia en el mural', `${convDeg.toFixed(2)}°`),
    row('Δ vergencia objeto cercano', `${dNear.toFixed(2)}° (≤ ${LIMITS.disparityMaxDeg}°)`),
    row('Δ vergencia fondo', `${dFar.toFixed(2)}° · paralaje ${(a.disparity.farM * 100).toFixed(1)} cm${farMatters ? (a.disparity.farOk ? ' ✓' : ' ✗ > IPD') : ''}`),
    row('eyeSep máximo', a.disparity.eyeSepMax.toFixed(3)),
    row('cross-eye desde', `${fmtM(a.cross.dMin)} · cómodo ${fmtM(a.cross.dComfort)}`),
    row('parallel', a.parallel.viable ? 'viable' : a.parallel.practical ? `desde ${fmtM(a.parallel.dMin)}` : 'inviable'),
    row('anaglifo desde', `${fmtM(a.disparity.dMin)} · cómodo ${fmtM(a.disparity.dComfort)}`),
  ].join('') + `</div><div class="rec ${cls}">${verdict}</div>`;
}

function save() {
  const { o } = recompute();
  saveCalibration({ screenW: o.screenW, ipd: o.ipd, fov: o.fov, zNear: o.zNear, pxW: o.pxW, pxH: o.pxH, bottom: o.bottom, savedAt: new Date().toISOString() });
  params.save('3deyes.calibpage');
  flash('calibración guardada');
}
function flash(msg) { const el = $('help'); const prev = el.textContent; el.textContent = msg; setTimeout(() => (el.textContent = prev), 1500); }

// ---------- cámara ----------
function applyView(name) {
  const { o } = last || recompute();
  const H = last.a.screenH, cy = o.bottom + H / 2, D = o.viewerD;
  camera.fov = 50;
  if (name === 'publico') {
    const p = stage.viewerPose(o); camera.position.copy(p.pos); controls.target.copy(p.target); camera.fov = params.get('camara.fovPublico');
  } else if (name === 'lateral') { camera.position.set(D * 0.9 + 8, 3.5, D / 2); controls.target.set(0, 1.5, D / 2); }
  else if (name === 'cenital') { camera.position.set(0.01, Math.max(20, D * 1.3), D / 2); controls.target.set(0, 0, D / 2); }
  else { camera.position.set(o.screenW * 0.7 + 4, Math.max(4, H * 0.8), D + 8); controls.target.set(0, cy * 0.6, D * 0.45); }
  camera.updateProjectionMatrix();
  controls.update();
}

// ---------- eventos ----------
let dirty = true;
params.onChange((id, value, source) => {
  if (id === 'contenido.preset') { $('src').value = PRESETS[value]; presetSel.value = value; compile(PRESETS[value]); }
  if (id === 'camara.vista') applyView(value);
  if (id === 'publico.distancia' && source !== 'auto') params.set('publico.auto', false, 'app');
  if (id === 'escenario.exposicion') renderer.toneMappingExposure = value;
  if (id === 'medidas.pxW' || id === 'medidas.pxH') wallRT.setSize(params.get('medidas.pxW'), params.get('medidas.pxH'));
  if (!id.startsWith('room.') && !id.startsWith('fluid.') && !id.startsWith('blob.') && !id.startsWith('track.') && !id.startsWith('look.')) dirty = true;
  if (source !== 'restore') scheduleSave();
});
let saveTimer;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => params.save('3deyes.calibpage'), 600); }

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight); labelRenderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const views = { 1: 'general', 2: 'publico', 3: 'lateral', 4: 'cenital' };
  if (views[k]) params.set('camara.vista', views[k]);
  else if (k === 'e') toggleEditor();
  else if (k === 'g') gui.toggle();
  else if (k === 'h') { for (const id of ['report', 'help', 'labels']) $(id).classList.toggle('hidden'); gui.toggle(); }
  else if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});

// ---------- loop ----------
const clock = new THREE.Clock();
let time = 0;
wallRT.setSize(params.get('medidas.pxW'), params.get('medidas.pxH'));
renderer.toneMappingExposure = params.get('escenario.exposicion');
recompute();
applyView(params.get('camara.vista'));

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1) * params.get('contenido.velocidad');
  time += dt;
  if (dirty) { recompute(); dirty = false; }
  audio.update(dt);

  // 1. contenido → textura del mural (a la resolución del proyector)
  const type = params.get('contenido.tipo');
  let content, cam;
  if (type === 'shader') { shaderToy.update(dt, time); content = shaderToy.scene; cam = shaderToy.camera; }
  else if (type === 'patron') { pattern.camera.fov = last.o.fov; pattern.update({ focus: last.o.focus, fov: last.o.fov, zNear: last.o.zNear, aspect: last.a.rL.w * last.o.pxW / (last.a.rL.h * last.o.pxH) }); content = pattern.scene; cam = pattern.camera; }
  else {
    const sc = appScenes[params.get('contenido.escena')]; sc.enter(); sc.update(dt, time);
    if (!sc.handlesDepthLook) depthLook.apply(sc.scene, sc.camera);
    content = sc.scene; cam = sc.camera;
  }
  // el fov de la cámara de contenido define la geometría: usar el de "medidas.fov" para shader/patrón
  if (type !== 'escena') cam.fov = last.o.fov;
  stereo.render(content, cam, wallRT, wallRT.width, wallRT.height);

  // 2. material del mural
  const u = stage.wall.material.uniforms;
  u.relief.value = params.get('contenido.relieve');
  u.reliefSource.value = ['alpha', 'luminancia', 'plano'].indexOf(params.get('contenido.relieveDe'));
  u.brightness.value = params.get('contenido.brillo'); u.aoAmount.value = params.get('contenido.ao'); u.shading.value = params.get('contenido.sombreado');

  // 3. escenario
  const pov = params.get('camara.vista') === 'publico';
  stage.person.setVisible(params.get('escenario.persona') && !pov);
  controls.update();
  renderer.setRenderTarget(null);
  renderer.render(stage.scene, camera);
  labelRenderer.render(stage.scene, camera);
});

window.calib = { params, stage, stereo, shaderToy, recompute };
