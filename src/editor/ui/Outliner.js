import { pathOf } from '../Project.js';

const ICONS = { SpotLight: '◭', Mesh: '▣', Group: '▤', Scene: '◈', Points: '⁘', Line: '╱', LineSegments: '╱', LineLoop: '○', DirectionalLight: '☀', PointLight: '✦', HemisphereLight: '◐', AmbientLight: '◌', RectAreaLight: '▭', PerspectiveCamera: '🎥', Object3D: '·', InstancedMesh: '▣' };
const MAX_CHILDREN = 80;

/** Árbol de objetos de la escena. */
export class Outliner {
  constructor(el, { onSelect, onVisible }) {
    this.el = el;
    this.onSelect = onSelect; this.onVisible = onVisible;
    this.root = null;
    this.selected = null;
    this.collapsed = new Set();
    this.lastCount = -1;
  }

  setRoot(root) { this.root = root; this.collapsed.clear(); this.build(); }

  count() { let n = 0; this.root?.traverse(() => n++); return n; }

  /** Reconstruye si cambió la cantidad de objetos (escenas con spawn dinámico). */
  poll() { const n = this.count(); if (n !== this.lastCount) this.build(); }

  build() {
    this.lastCount = this.count();
    this.el.innerHTML = '';
    if (!this.root) return;
    const add = (obj, depth) => {
      const path = pathOf(obj, this.root);
      const row = document.createElement('div');
      row.className = 'node' + (obj === this.selected ? ' sel' : '') + (obj.visible ? '' : ' dim');
      row.style.paddingLeft = `${6 + depth * 12}px`;
      row.dataset.path = path;
      const kids = obj.children.length;
      const isCollapsed = this.collapsed.has(path) || ((depth >= 2 || kids > 12) && !this.collapsed.has('!' + path));
      row.innerHTML = `<span class="caret">${kids ? (isCollapsed ? '▸' : '▾') : ''}</span><span class="icon">${ICONS[obj.type] || '·'}</span><span class="name" title="${path}">${obj.name || obj.type}${kids ? ` <span class="muted">(${kids})</span>` : ''}</span><span class="eye${obj.visible ? '' : ' off'}">${obj.visible ? '◉' : '◎'}</span>`;
      row.querySelector('.caret').onclick = (e) => { e.stopPropagation(); if (isCollapsed) { this.collapsed.delete(path); this.collapsed.add('!' + path); } else { this.collapsed.add(path); this.collapsed.delete('!' + path); } this.build(); };
      row.querySelector('.eye').onclick = (e) => { e.stopPropagation(); obj.visible = !obj.visible; this.onVisible?.(obj); this.build(); };
      row.onclick = () => this.onSelect?.(obj);
      this.el.appendChild(row);
      if (kids && !isCollapsed) {
        obj.children.slice(0, MAX_CHILDREN).forEach((c) => add(c, depth + 1));
        if (kids > MAX_CHILDREN) { const more = document.createElement('div'); more.className = 'node muted'; more.style.paddingLeft = `${6 + (depth + 1) * 12}px`; more.textContent = `… ${kids - MAX_CHILDREN} más`; this.el.appendChild(more); }
      }
    };
    this.root.children.forEach((c) => add(c, 0));
  }

  select(obj) {
    this.selected = obj;
    for (const row of this.el.querySelectorAll('.node')) row.classList.toggle('sel', !!obj && row.dataset.path === pathOf(obj, this.root));
    const sel = this.el.querySelector('.node.sel'); sel?.scrollIntoView({ block: 'nearest' });
  }
}
