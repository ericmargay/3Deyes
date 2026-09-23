import GUI from 'lil-gui';

/**
 * Panel de control (lil-gui) generado automáticamente desde el bus de parámetros.
 * - Una carpeta por grupo (stereo, look, room, fluid, ...).
 * - Doble clic sobre el nombre de un parámetro → modo "learn": el próximo
 *   control físico que se mueva (MIDI / serial / OSC) queda asignado.
 * - Clic derecho sobre el nombre → borra la asignación.
 */
export class Gui {
  constructor(params, actions = {}, openGroups = ['stereo', 'scene'], title = '3Deyes', container = null) {
    this.params = params;
    this.openGroups = openGroups;
    this.gui = new GUI(container ? { title, container } : { title });
    this.folders = new Map();
    this.controllers = new Map();
    this.actions = actions;

    const sys = this.gui.addFolder('conexiones');
    for (const [name, fn] of Object.entries(actions)) sys.add({ [name]: fn }, name);
    sys.close();

    for (const d of params.defs.values()) this.addController(d);
    params.addEventListener('define', (e) => this.addController(e.detail));
    params.addEventListener('change', (e) => {
      const c = this.controllers.get(e.detail.id);
      if (c && e.detail.source !== 'gui') c.updateDisplay();
    });
    params.addEventListener('learn', (e) => this.highlightLearn(e.detail.id));
    params.addEventListener('bind', (e) => this.labelBinding(e.detail.id));
    for (const id of params.bindings.values()) this.labelBinding(id);
  }

  folder(group) {
    if (!this.folders.has(group)) {
      const f = this.gui.addFolder(group);
      this.folders.set(group, f);
      if (!this.openGroups.includes(group)) f.close();
    }
    return this.folders.get(group);
  }

  addController(d) {
    if (this.controllers.has(d.id)) { this.controllers.get(d.id).destroy(); }
    const f = this.folder(d.group);
    let c;
    const setter = (v) => this.params.set(d.id, v, 'gui');
    if (d.type === 'number') c = f.add({ v: d.value }, 'v', d.min, d.max, d.step || (d.max - d.min) / 1000).onChange(setter);
    else if (d.type === 'boolean') c = f.add({ v: d.value }, 'v').onChange(setter);
    else if (d.type === 'option') c = f.add({ v: d.value }, 'v', d.options).onChange(setter);
    else if (d.type === 'trigger') c = f.add({ v: () => this.params.set(d.id, 1, 'gui') }, 'v');
    else return;
    c.name(d.label);
    // sincroniza el objeto interno del controlador con el valor real
    const orig = c.updateDisplay.bind(c);
    c.updateDisplay = () => { if (d.type !== 'trigger') c.object.v = d.value; return orig(); };
    c.$name.style.cursor = 'pointer';
    c.$name.title = `${d.id}\n(doble clic: asignar control · clic derecho: quitar)`;
    c.$name.addEventListener('dblclick', () => this.params.learn(d.id));
    c.$name.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.params.unbind(d.id); this.labelBinding(d.id); });
    this.controllers.set(d.id, c);
    this.labelBinding(d.id);
  }

  labelBinding(id) {
    const c = this.controllers.get(id);
    const d = this.params.def(id);
    if (!c || !d) return;
    const b = this.params.bindingFor(id);
    c.name(b ? `${d.label}  ⟵ ${b.replace(/^(midi|serial|osc):/, '$1 ')}` : d.label);
  }

  highlightLearn(id) {
    for (const [cid, c] of this.controllers) c.$name.style.color = cid === id ? '#ff4fa3' : '';
  }

  removeGroup(group) {
    const f = this.folders.get(group);
    if (!f) return;
    for (const id of [...this.controllers.keys()]) if (id.startsWith(group + '.')) this.controllers.delete(id);
    f.destroy();
    this.folders.delete(group);
  }

  toggle() { this.gui.show(this.gui._hidden); }
}
