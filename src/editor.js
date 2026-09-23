import * as THREE from 'three';
import { Params } from './core/Params.js';
import { Gui } from './control/Gui.js';
import { MidiInput } from './control/Midi.js';
import { SerialInput } from './control/Serial.js';
import { SocketInput } from './control/Socket.js';
import { AudioInput } from './control/Audio.js';
import { StereoOutput, STEREO_MODES } from './output/StereoOutput.js';
import { DepthLook } from './scenes/BaseScene.js';
import { RoomScene } from './scenes/RoomScene.js';
import { FluidScene } from './scenes/FluidScene.js';
import { BlobScene } from './scenes/BlobScene.js';
import { TrackScene } from './scenes/TrackScene.js';
import { Project, nameObjects, applyOverrides, captureOverride, pathOf } from './editor/Project.js';
import { TimelinePlayer } from './editor/Timeline.js';
import { RuleEngine } from './editor/Rules.js';
import { Viewport } from './editor/ui/Viewport.js';
import { Outliner } from './editor/ui/Outliner.js';
import { Inspector } from './editor/ui/Inspector.js';
import { TimelineUI } from './editor/ui/TimelineUI.js';
import { RulesUI, ConnectionsUI, actionEditor } from './editor/ui/RulesUI.js';

/**
 * Editor de escenas. Las escenas son las plantillas; el editor guarda encima
 * un proyecto (overrides de objetos, línea de tiempo, reglas) que la app
 * reproduce. Los parámetros se comparten con la app por localStorage.
 */
const $ = (id) => document.getElementById(id);
const params = new Params();
const SCENE_CLASSES = { room: RoomScene, fluid: FluidScene, blob: BlobScene, track: TrackScene };
const SCENE_KEYS = Object.keys(SCENE_CLASSES);
params.define('scene.current', { type: 'option', options: SCENE_KEYS, default: 'room', label: 'escena' });

// ---------- renderer ----------
const center = $('center');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
center.appendChild(renderer.domElement);
const stereo = new StereoOutput(renderer, params);
const depthLook = new DepthLook(params);
params.load('3deyes.params');
for (const [k, v] of new URLSearchParams(location.search)) { if (params.has(k)) params.set(k, v, 'url'); else if (k.includes('.')) params.pending[k] = Number.isNaN(Number(v)) ? v : Number(v); }

// ---------- runtime compartido con la app ----------
const project = Project.load();
const log = (m) => { console.log('[editor]', m); status(m); };
const audio = new AudioInput(params, log);
const midi = new MidiInput(params, log), serial = new SerialInput(params, log), socket = new SocketInput(params, log);
const rules = new RuleEngine(params, { setScene: (k) => setScene(k), nextScene: () => setScene(SCENE_KEYS[(SCENE_KEYS.indexOf(current.key) + 1) % SCENE_KEYS.length]), timeline: null, log: (m) => status(m) });
const timeline = new TimelinePlayer(params, { getRoot: () => current?.scene, runAction: (a) => rules.run(a), onChange: () => tick() });
rules.ctx.timeline = timeline;
const fakeApp = { renderer, params, audio, emit: (type, detail) => rules.handle(type, detail) };
const scenes = Object.fromEntries(SCENE_KEYS.map((k) => [k, new SCENE_CLASSES[k](fakeApp)]));
let current = null, mode = 'edit', camMode = 'editor', recording = false, animating = true, selected = null, nextSelectCb = null;

// ---------- UI ----------
const openGroups = ['stereo'];
const gui = new Gui(params, {
  'MIDI (Ableton)': () => midi.connect(), 'serial (ESP32)': () => serial.connect(), 'WebSocket / OSC': () => socket.connect(),
  'audio (mic)': () => audio.connect(), 'audio: archivo': () => audio.pickFile(),
}, openGroups, '3Deyes', $('guiHost'));
midi.connect().catch(() => {});

const editorCtx = { paramOptions: () => [...params.defs.values()].map((d) => ({ value: d.id, label: d.id, type: d.type })), sceneKeys: SCENE_KEYS };
const capture = {
  input: (cb) => { const h = (e) => { if (!e.detail.moved) return; params.removeEventListener('input', h); cb(e.detail.sourceKey); }; params.addEventListener('input', h); },
  key: (cb) => { const h = (e) => { window.removeEventListener('keydown', h, true); e.preventDefault(); cb(e.key); }; window.addEventListener('keydown', h, true); },
  click: (cb) => { nextSelectCb = cb; status('elegí un objeto en el viewport'); },
};

const viewport = new Viewport(center, renderer, {
  onSelect: (obj) => select(obj),
  onTransform: () => inspector.refresh(),
  onTransformEnd: (obj) => { saveOverride(obj); if (recording) keyTransform(obj); },
});
const outliner = new Outliner($('tree'), { onSelect: (o) => select(o), onVisible: (o) => saveOverride(o) });
const inspector = new Inspector($('inspector'), {
  timeline, project, root: () => current?.scene, onOverride: (o) => saveOverride(o),
  onKeysChanged: () => { saveProject(); timelineUI.refresh(); },
  recording: () => recording, focus: (o) => viewport.frame(o),
  resetOverride: (o) => { if (current) { delete project.scene(current.key).overrides[pathOf(o, current.scene)]; saveProject(); } },
  actionEditor: (el, a, cb) => actionEditor(el, a, cb, editorCtx),
});
const timelineUI = new TimelineUI({
  tracks: $('tlTracks'), canvas: $('tlCanvas'), wrap: $('tlCanvasWrap'), time: $('tTime'), play: $('tPlay'), start: $('tStart'), stop: $('tStop'),
  dur: $('tDur'), bpm: $('tBpm'), loop: $('tLoop'), snap: $('tSnap'), auto: $('tAuto'), rec: $('tRec'), zoom: $('tZoom'), addTrack: $('tAddTrack'), addCue: $('tAddCue'),
}, timeline, {
  onSelectKey: (t, k) => { inspector.showKey(t, k); showTab('inspector'); },
  onSelectCue: (c) => { inspector.showCue(c); showTab('inspector'); },
  onChanged: () => saveProject(),
  recording: () => recording, toggleRecording: () => { recording = !recording; status(recording ? '● grabando keyframes' : 'grabación detenida'); },
  trackOptions: () => [...params.defs.values()].filter((d) => (d.type === 'number' || d.type === 'boolean') && (d.group === current?.key || d.group === 'look' || d.group === 'stereo')).map((d) => ({ value: `param:${d.id}`, label: d.id })),
  defaultCueAction: () => ({ type: 'trigger', id: [...params.defs.values()].find((d) => d.type === 'trigger' && d.group === current?.key)?.id ?? 'scene.next' }),
});
const rulesUI = new RulesUI($('rules'), { getRules: () => (current ? project.scene(current.key).rules : []), onChanged: () => { saveProject(); rules.load(project.scene(current.key).rules); }, capture, editorCtx });
const connUI = new ConnectionsUI($('conn'), { params, onChanged: () => params.save('3deyes.params') });

// pestañas
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => showTab(b.dataset.tab);
function showTab(name) {
  const b = document.querySelector(`.tabs button[data-tab=${name}]`); if (!b) return;
  const tabs = b.parentElement;
  for (const x of tabs.querySelectorAll('button')) x.classList.toggle('on', x === b);
  for (const x of tabs.parentElement.querySelectorAll('.tab')) x.classList.toggle('on', x.id === `tab-${name}`);
}

// barra superior
const sceneSel = $('sceneSel');
sceneSel.innerHTML = SCENE_KEYS.map((k) => `<option value="${k}">${k}</option>`).join('');
sceneSel.onchange = () => setScene(sceneSel.value);
$('stereoSel').innerHTML = STEREO_MODES.map((m) => `<option>${m}</option>`).join('');
$('stereoSel').value = params.get('stereo.mode');
$('stereoSel').onchange = () => params.set('stereo.mode', $('stereoSel').value, 'editor');
$('modeEdit').onclick = () => setMode('edit'); $('modePlay').onclick = () => setMode('play');
$('camSel').onchange = () => { camMode = $('camSel').value; viewport.enabled = camMode === 'editor'; };
$('save').onclick = () => { saveProject(); params.save('3deyes.params'); status('guardado ✓'); };
$('export').onclick = () => project.export();
$('import').onclick = async () => { const p = await Project.importFile(); if (p) { Object.assign(project.data, p.data); saveProject(); setScene(current.key, true); status('proyecto importado'); } };
$('openApp').onclick = () => { saveProject(); params.save('3deyes.params'); window.open(`/?scene.current=${current.key}`, '_blank'); };
$('presetSave').onclick = () => { const name = prompt('nombre del preset'); if (!name) return; const ps = project.scene(current.key); const values = {}; for (const id of params.ids(current.key)) if (params.def(id).type !== 'trigger') values[id] = params.get(id); ps.presets[name] = { params: values }; saveProject(); refreshPresets(); };
$('presetSel').onchange = () => { const ps = project.scene(current.key).presets[$('presetSel').value]; if (!ps) return; for (const [id, v] of Object.entries(ps.params)) params.set(id, v, 'preset'); };
$('gT').onclick = () => gizmoMode('translate'); $('gR').onclick = () => gizmoMode('rotate'); $('gS').onclick = () => gizmoMode('scale'); $('gF').onclick = () => viewport.frame(selected);
const gA = document.createElement('button'); gA.id = 'gA'; gA.className = 'on'; gA.textContent = 'animar'; gA.title = 'la escena sigue animando mientras editás'; gA.onclick = () => { animating = !animating; gA.classList.toggle('on', animating); }; $('vpTools').appendChild(gA);
function gizmoMode(m) { viewport.setMode(m); for (const [id, mm] of [['gT', 'translate'], ['gR', 'rotate'], ['gS', 'scale']]) $(id).classList.toggle('on', mm === m); }
function setMode(m) {
  mode = m; $('modeEdit').classList.toggle('on', m === 'edit'); $('modePlay').classList.toggle('on', m === 'play');
  viewport.enabled = m === 'edit' && camMode === 'editor';
  if (m === 'play') { select(null); timeline.play(); } else timeline.pause();
  tick();
}
function refreshPresets() {
  const ps = project.scene(current.key).presets;
  $('presetSel').innerHTML = '<option value="">—</option>' + Object.keys(ps).map((n) => `<option>${n}</option>`).join('');
}
let statusTimer;
function status(msg) { $('status').textContent = msg; clearTimeout(statusTimer); statusTimer = setTimeout(() => ($('status').textContent = ''), 2500); }

// ---------- escenas ----------
function setScene(key, force = false) {
  if (!scenes[key] || (current?.key === key && !force)) return;
  const first = !current;
  current?.exit();
  current = scenes[key];
  if (!openGroups.includes(key)) openGroups.push(key);
  current.enter();
  params.set('scene.current', key, 'editor');
  sceneSel.value = key;
  nameObjects(current.scene);
  const ps = project.scene(key);
  applyOverrides(current.scene, ps.overrides);
  rules.load(ps.rules);
  timeline.load(ps.timeline, false);
  current.update(0, 0);
  viewport.setRoot(current.scene);
  if (first || force) viewport.matchCamera(current.camera);
  outliner.setRoot(current.scene);
  select(null);
  rulesUI.setRules();
  timelineUI._optsDirty = true; timelineUI.refresh();
  refreshPresets();
  rules.handle('enter', { scene: key });
}

function select(obj) {
  selected = obj;
  viewport.select(obj); outliner.select(obj); inspector.show(obj);
  if (obj && nextSelectCb) { const cb = nextSelectCb; nextSelectCb = null; cb(pathOf(obj, current.scene)); showTab('rules'); }
  else if (obj) showTab('inspector');
}

function saveOverride(obj) {
  if (!obj || !current) return;
  const path = pathOf(obj, current.scene); if (!path) return;
  project.scene(current.key).overrides[path] = captureOverride(obj);
  saveProject();
}
function keyTransform(obj) {
  const path = pathOf(obj, current.scene);
  for (const c of ['x', 'y', 'z']) { timeline.setKey(`obj:${path}:position.${c}`, obj.position[c]); timeline.setKey(`obj:${path}:rotation.${c}`, obj.rotation[c]); timeline.setKey(`obj:${path}:scale.${c}`, obj.scale[c]); }
  saveProject(); timelineUI.refresh();
}
let saveTimer, paramsTimer;
function saveProject() { clearTimeout(saveTimer); saveTimer = setTimeout(() => project.save(), 300); }
params.onChange((id, value, source) => {
  if (source === 'gui' && recording) { const d = params.def(id); if (d.type === 'number' || d.type === 'boolean') { timeline.setKey(`param:${id}`, value); timelineUI.refresh(); saveProject(); } }
  if (id === 'stereo.mode') $('stereoSel').value = value;
  if (id === 'scene.current' && source !== 'editor' && scenes[value]) setScene(value);
  if (source !== 'restore' && source !== 'timeline' && source !== 'rule') { clearTimeout(paramsTimer); paramsTimer = setTimeout(() => params.save('3deyes.params'), 500); }
});

// clic en modo reproducir → evento para las reglas (como en la app)
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'play' || !current) return;
  const r = center.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -((e.clientY - r.top) / r.height) * 2 + 1;
  current.onPointerDown?.(x, y);
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), current.camera);
  const hit = ray.intersectObjects(current.scene.children, true).find((h) => h.object.visible);
  rules.handle('click', { x, y, path: hit ? pathOf(hit.object, current.scene) : null });
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mode !== 'play' || !current) return;
  const r = center.getBoundingClientRect();
  current.onPointerMove?.(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
});

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (mode === 'play') rules.handle('key', { key: e.key });
  if (k === ' ') { e.preventDefault(); timeline.toggle(); timelineUI.refresh(); }
  else if (k === 'w') gizmoMode('translate'); else if (k === 'e') gizmoMode('rotate'); else if (k === 'r') gizmoMode('scale');
  else if (k === 'f') viewport.frame(selected);
  else if (k === 'escape') select(null);
  else if (k === 'tab') { e.preventDefault(); setMode(mode === 'edit' ? 'play' : 'edit'); }
  else if (k === 'k' && selected) { for (const c of ['x', 'y', 'z']) timeline.setKey(`obj:${pathOf(selected, current.scene)}:position.${c}`, selected.position[c]); saveProject(); timelineUI.refresh(); }
});

// ---------- tamaño ----------
function resize() {
  const w = Math.max(10, center.clientWidth), h = Math.max(10, center.clientHeight);
  renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  viewport.setSize(w, h);
}
new ResizeObserver(resize).observe(center);
resize();

// ---------- loop ----------
const clock = new THREE.Clock();
let time = 0, pollT = 0;
function tick() {
  $('tTime').textContent = `${timeline.time.toFixed(2)} s`;
  $('tPlay').textContent = timeline.playing ? '⏸' : '▶';
  timelineUI.draw();
}
setScene(params.get('scene.current') || 'room');
setMode('edit');
$('hint').textContent = 'clic: seleccionar · W/E/R: mover/rotar/escalar · F: enfocar · K: keyframe de posición · espacio: play · Tab: editar/reproducir';

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  audio.update(dt);
  if (audio.beat) rules.handle('beat', {});
  if (current && (mode === 'play' || animating)) { time += dt; current.update(dt, time); }
  timeline.update(dt);
  rules.update(dt);
  if (!current) return;
  const editorCam = mode === 'edit' && camMode === 'editor';
  const cam = editorCam ? viewport.camera : current.camera;
  if (!current.handlesDepthLook) depthLook.apply(current.scene, current.camera);
  viewport.update();
  if (mode === 'edit') { renderer.setRenderTarget(null); renderer.render(current.scene, cam); viewport.renderHelpers(editorCam); }
  else stereo.render(current.scene, cam);
  pollT += dt; if (pollT > 1) { pollT = 0; outliner.poll(); }
});

const q = new URLSearchParams(location.search);
if (q.get('demo')) {
  const id = params.ids(current.key).find((i) => params.def(i).type === 'number');
  if (id) { timeline.setKey(`param:${id}`, params.get(id), 0); timeline.setKey(`param:${id}`, params.def(id).max, 8); timeline.setKey(`param:${id}`, params.get(id), 16); }
  timeline.clip.cues.push({ t: 4, action: { type: 'nextScene' } });
  timelineUI.refresh();
}
if (q.get('select')) { const o = current.scene.getObjectByName(q.get('select').split('/').pop()); if (o) { select(o); viewport.frame(o); } }
window.editor = { params, project, timeline, rules, scenes, setScene, viewport };
