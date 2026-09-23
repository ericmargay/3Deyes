import { loadCalibration, analyze, fmtM, LIMITS } from './core/StereoMath.js';

/**
 * Diseño del estereoscopio: periscopio de dos espejos por ojo (tipo
 * Wheatstone / Schilling) que lleva cada ojo directo al centro de su imagen
 * sin converger ni divergir, más la alternativa de anteojos prismáticos.
 * Todo en milímetros salvo lo indicado.
 */
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const fields = ['screenW', 'sep', 'imgW', 'D', 'ipd', 'content', 'a', 'm', 'margin', 'minFov'];

function read() {
  const o = {};
  for (const f of fields) o[f] = f === 'content' ? $(f).value : Number($(f).value);
  return o;
}

function design(o) {
  const ipd = o.ipd, a = o.a, m = o.m, D = o.D * 1000, S = o.sep * 1000, W = o.imgW * 1000;
  const cross = o.content === 'cross';
  // cada ojo mira, a través del periscopio, el centro de "su" imagen
  const outerX = ipd / 2 + m;                       // posición lateral del espejo externo (derecho)
  const targetX = cross ? -S / 2 : S / 2;           // centro de la imagen que mira el ojo derecho
  const phi = Math.atan2(targetX - outerX, D - a);  // desviación respecto al frente (+ = hacia afuera)
  const outerAngle = 45 - (phi / DEG) / 2;          // ángulo del espejo externo respecto al brazo
  // campo visual necesario: la imagen vista desde D, con margen
  const imgFov = 2 * Math.atan(W / 2 / D) / DEG;
  const fov = Math.max(o.minFov, imgFov * o.margin);
  const t = Math.tan((fov / 2) * DEG);
  const pupil = 8;
  const innerW = 2 * a * t + pupil;                 // apertura útil del espejo interno (ancho del haz)
  const outerW = 2 * (a + m) * t + pupil;
  const innerLen = innerW * Math.SQRT2;             // largo físico a 45°
  const outerLen = outerW / Math.cos((45 - outerAngle) * DEG) * Math.SQRT2 / Math.SQRT2 / Math.cos(45 * DEG) * Math.cos(45 * DEG); // ≈ ancho / cos(ángulo)
  const outerLenReal = outerW / Math.sin(outerAngle * DEG);
  // prismas
  const prismCrossDeg = Math.atan((S / 2 + ipd / 2) / D) / DEG;   // cross: cada ojo mira la imagen contraria
  const prismParDeg = Math.atan(Math.max(0, S / 2 - ipd / 2) / D) / DEG;
  const pd = (deg) => 100 * Math.tan(deg * DEG);
  return { ipd, a, m, outerX, phi, outerAngle, imgFov, fov, innerW, innerLen, outerW, outerLen: outerLenReal, prismCrossDeg, prismParDeg, prismCrossPD: pd(prismCrossDeg), prismParPD: pd(prismParDeg), cross, baseline: 2 * outerX, D: o.D, S: o.sep };
}

function report(o, d) {
  const row = (k, v) => `<span>${k}</span><b>${v}</b>`;
  $('out').innerHTML = [
    row('imagen vista desde D', `${d.imgFov.toFixed(1)}° de campo`),
    row('campo visual de diseño', `${d.fov.toFixed(1)}°`),
    row('desviación φ por ojo', `${(d.phi / DEG).toFixed(2)}° ${d.phi > 0 ? 'hacia afuera' : 'hacia adentro'}`),
    row('espejo interno', `45° · ${d.innerW.toFixed(0)} × ${d.innerLen.toFixed(0)} mm`),
    row('espejo externo', `${d.outerAngle.toFixed(2)}° · ${d.outerW.toFixed(0)} × ${d.outerLen.toFixed(0)} mm`),
    row('línea de base efectiva', `${d.baseline.toFixed(0)} mm`),
    row('ancho total del artefacto', `≈ ${(d.baseline + d.outerLen).toFixed(0)} mm`),
    row('prismas (cross)', `${d.prismCrossDeg.toFixed(1)}° = ${d.prismCrossPD.toFixed(1)} Δ base interna / ojo`),
    row('prismas (parallel)', `${d.prismParDeg.toFixed(1)}° = ${d.prismParPD.toFixed(1)} Δ base externa / ojo`),
  ].join('');
  const notes = [];
  if (Math.abs(d.phi / DEG) > 12) notes.push('<div class="warn">φ grande: el espejo externo queda muy girado; alargá el brazo m o alejá al público.</div>');
  if (d.outerLen > 160) notes.push('<div class="warn">Espejo externo grande (> 160 mm): acercá el público, bajá el margen o achicá el brazo.</div>');
  notes.push(d.cross ? '<div class="ok">Con periscopio el contenido puede ser <b>parallel</b>: el ojo derecho mira la imagen derecha y los ojos quedan paralelos y relajados. Cross solo tiene sentido sin aparato.</div>' : '<div class="ok">Periscopio + contenido parallel: cada ojo mira de frente su imagen, sin converger. Es la configuración recomendada.</div>');
  notes.push(`<div class="note">Prismas: hasta ~10 Δ por ojo en lentes oftálmicos, hasta ~30–40 Δ con láminas Fresnel adhesivas. ${d.prismCrossPD > 12 ? 'Para cross a esta distancia harían falta Fresnel.' : 'Para cross alcanzaría con lentes prismáticos comunes.'}</div>`);
  $('verdict').innerHTML = notes.join('');
}

function plan(d) {
  // escala: 1 mm → k px
  const widthMm = d.baseline + d.outerLen + 120, k = Math.min(2.4, 900 / widthMm);
  const cx = 480, cy = 330;
  const X = (mm) => cx + mm * k, Z = (mm) => cy - mm * k;   // z hacia arriba de la hoja = hacia el mural
  const el = [];
  const line = (x1, z1, x2, z2, col, w = 2, dash = '') => el.push(`<line x1="${X(x1)}" y1="${Z(z1)}" x2="${X(x2)}" y2="${Z(z2)}" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`);
  const text = (x, z, t, col = '#ccc', anchor = 'middle', size = 11) => el.push(`<text x="${X(x)}" y="${Z(z)}" fill="${col}" font-size="${size}" text-anchor="${anchor}" font-family="ui-monospace, monospace">${t}</text>`);
  const mirror = (x, z, angleDeg, len, col) => { const r = angleDeg * DEG, dx = Math.cos(r) * len / 2, dz = Math.sin(r) * len / 2; line(x - dx, z - dz, x + dx, z + dz, col, 5); line(x - dx, z - dz, x + dx, z + dz, '#fff', 1.2); };
  // cabeza y ojos
  el.push(`<ellipse cx="${X(0)}" cy="${Z(-70)}" rx="${80 * k}" ry="${95 * k}" fill="none" stroke="#333" stroke-width="1.5"/>`);
  for (const s of [-1, 1]) {
    const ex = s * d.ipd / 2, ox = s * d.outerX;
    el.push(`<circle cx="${X(ex)}" cy="${Z(0)}" r="${6 * k}" fill="${s < 0 ? '#ff4fa3' : '#4fd1c5'}"/>`);
    // espejo interno a 45°: refleja el haz hacia afuera (s)
    mirror(ex, d.a, s > 0 ? -45 : 45, d.innerLen, '#8fa');
    // espejo externo
    const ang = s > 0 ? -d.outerAngle : d.outerAngle;
    mirror(ox, d.a, ang, d.outerLen, '#fd8');
    // rayos: ojo → interno → externo → hacia la imagen
    const col = s < 0 ? '#ff4fa3' : '#4fd1c5';
    line(ex, 0, ex, d.a, col, 1.5);
    line(ex, d.a, ox, d.a, col, 1.5);
    const L = 260; const phi = s * d.phi;
    line(ox, d.a, ox + Math.sin(phi) * L, d.a + Math.cos(phi) * L, col, 1.5, '6 4');
    text(ox + Math.sin(phi) * L, d.a + Math.cos(phi) * L + 12, `→ centro imagen ${s < 0 ? (d.cross ? 'derecha' : 'izquierda') : (d.cross ? 'izquierda' : 'derecha')} (φ ${(s * d.phi / DEG).toFixed(1)}°)`, col, s < 0 ? 'end' : 'start', 10);
    // cotas
    text(ox, d.a - 22, `externo ${d.outerAngle.toFixed(1)}° · ${d.outerW.toFixed(0)}×${d.outerLen.toFixed(0)}`, '#fd8', 'middle', 10);
    text(ex, d.a + 30, `interno 45° · ${d.innerW.toFixed(0)}×${d.innerLen.toFixed(0)}`, '#8fa', 'middle', 10);
  }
  // cotas principales
  line(-d.ipd / 2, -25, d.ipd / 2, -25, '#888', 1); text(0, -32, `IPD ${d.ipd} mm`, '#aaa');
  line(d.ipd / 2, -12, d.outerX, -12, '#888', 1); text((d.ipd / 2 + d.outerX) / 2, -19, `m ${d.m} mm`, '#aaa');
  line(-d.outerX, -50, d.outerX, -50, '#888', 1); text(0, -57, `línea de base ${d.baseline.toFixed(0)} mm`, '#aaa');
  line(d.outerX + d.outerLen / 2 + 15, 0, d.outerX + d.outerLen / 2 + 15, d.a, '#888', 1); text(d.outerX + d.outerLen / 2 + 22, d.a / 2, `a ${d.a}`, '#aaa', 'start', 10);
  text(0, 200, `mural a ${d.D} m · imágenes separadas ${d.S} m · vista desde arriba · escala 1 mm = ${k.toFixed(2)} px`, '#777', 'middle', 10);
  $('plan').innerHTML = `<svg viewBox="0 0 960 420">${el.join('')}</svg>`;
}

function parts(d) {
  const rows = [
    ['2 × espejo interno', `${Math.ceil(d.innerW + 6)} × ${Math.ceil(d.innerLen + 6)} mm, espejo de primera superficie (acrílico o vidrio), 2–3 mm`],
    ['2 × espejo externo', `${Math.ceil(d.outerW + 6)} × ${Math.ceil(d.outerLen + 6)} mm, espejo de primera superficie`],
    ['2 × brazo', `${d.m} mm de largo (entre centros de espejos), sección cerrada y negra por dentro`],
    ['1 × montura', 'visor VR (Gear VR / Cardboard) sin lentes ni teléfono, o gafas de soldador / máscara de snorkel sin cristal'],
    ['pivote de cada espejo externo', `ajuste fino ±5° alrededor de ${d.outerAngle.toFixed(1)}° (tornillo o bisagra con tope)`],
    ['separador de ojos', 'ajuste de IPD 58–72 mm si el aparato es para el público general'],
  ];
  $('parts').innerHTML = '<tr><th>pieza</th><th>medida / nota</th></tr>' + rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  $('howto').innerHTML = `<h2 style="margin-top:0">Cómo funciona y cómo armarlo</h2>
  <p>Cada ojo mira <b>de frente</b> un espejo a 45° (interno) que desvía la vista 90° hacia afuera, hasta un segundo espejo (externo) que la vuelve a mandar hacia adelante, apuntando al centro de la imagen que le corresponde. Los ojos quedan paralelos y relajados, como mirando al infinito: la fusión es automática porque cada ojo solo puede ver "su" imagen. Dos reflexiones dejan la imagen sin invertir. Es el principio del estereoscopio de espejos de Wheatstone (1838) y de las <i>Sehmaschinen</i> de Alfons Schilling; James Turrell usó la misma idea con pares fotográficos.</p>
  <ol>
    <li><b>Contenido en parallel.</b> Con periscopio el ojo izquierdo mira la imagen izquierda. Poné la app en modo <code>parallel</code> (no cross).</li>
    <li><b>Espejos de primera superficie.</b> Un espejo común refleja también en el vidrio frontal y produce una imagen fantasma desplazada, que arruina el estéreo. Acrílico o vidrio "first surface" (se venden por hoja, se cortan con cutter o sierra fina).</li>
    <li><b>Internos a 45° fijos</b>, a ${d.a} mm de los ojos, uno frente a cada ojo, reflejando hacia afuera. Deben tapar por completo la visión directa del mural (si el ojo ve el mural directo, se rompe la ilusión). Poné un tabique negro entre ambos ojos.</li>
    <li><b>Externos a ${d.outerAngle.toFixed(1)}°</b> respecto al brazo (45° menos la mitad de φ), a ${d.m} mm hacia afuera de cada espejo interno. Ese ángulo depende de la distancia del público: por eso conviene un pivote con tope y una marca para la posición calculada (o varias marcas para varias distancias).</li>
    <li><b>Tamaño de los espejos</b> según el campo visual de diseño (${d.fov.toFixed(0)}°): interno ${d.innerW.toFixed(0)} × ${d.innerLen.toFixed(0)} mm, externo ${d.outerW.toFixed(0)} × ${d.outerLen.toFixed(0)} mm. Todo lo que no sea espejo, negro mate.</li>
    <li><b>Montaje sobre el visor VR.</b> Sacá el teléfono y las lentes (las lentes enfocan a 5 cm, el mural quedaría borroso). Las aberturas de las lentes quedan como ventanas para los ojos. Sobre el frente del visor fijá una placa (cartón pluma, MDF 3 mm o impresión 3D) que lleve los dos espejos internos y los dos brazos con los externos. El visor aporta correa, apoyo facial y bloqueo de luz lateral.</li>
    <li><b>Alineación.</b> De pie a ${d.D} m con la app en modo parallel y "puntos de fusión" activados: girá cada espejo externo hasta que el punto de fusión de cada imagen quede centrado en su ojo; al fusionar se ve un solo punto. Marcá la posición.</li>
    <li><b>Alternativa sin espejos: anteojos prismáticos.</b> Para cross hacen falta ${d.prismCrossPD.toFixed(1)} Δ base interna por ojo (${d.prismCrossDeg.toFixed(1)}°); para parallel ${d.prismParPD.toFixed(1)} Δ base externa. Un óptico los monta en armazón común hasta ~10 Δ; más allá, láminas Fresnel adhesivas sobre gafas de seguridad. Tienen algo de aberración cromática en los bordes.</li>
    <li><b>Alternativa digital.</b> El mismo contenido en un teléfono dentro del visor VR con lentes (modo <code>vr</code> de la app): sirve para quien no logra fusionar de ninguna forma, aunque ya no está mirando el mural.</li>
  </ol>
  <p class="note">Ajustá "distancia del público" según la calibración: a mayor distancia, φ y los tamaños de espejo bajan. La línea de base efectiva del aparato (${d.baseline.toFixed(0)} mm) no cambia la profundidad percibida: la profundidad la define el par estéreo proyectado, no el aparato.</p>`;
}

function update() { const o = read(); const d = design(o); report(o, d); plan(d); parts(d); }
for (const f of fields) $(f).addEventListener('input', update);
$('fromCalib').onclick = () => {
  const c = loadCalibration();
  let sp = {}; try { sp = JSON.parse(localStorage.getItem('3deyes.params') || '{}').values || {}; } catch (_) { /* */ }
  if (!c) { alert('No hay calibración guardada. Abrí /calibrate.html y guardala.'); return; }
  const a = analyze({ mode: 'parallel', scale: sp['stereo.scale'] ?? 0.9, gap: sp['stereo.gap'] ?? 0.02, eyeSep: sp['stereo.eyeSep'] ?? 0.25, focus: sp['stereo.focus'] ?? 10, fov: c.fov || 45, screenW: c.screenW, pxW: c.pxW || 1920, pxH: c.pxH || 1080, ipd: c.ipd, zNear: c.zNear });
  $('screenW').value = c.screenW.toFixed(2); $('sep').value = a.sepX.toFixed(2); $('imgW').value = a.imageW.toFixed(2); $('ipd').value = (c.ipd * 1000).toFixed(1);
  $('D').value = Math.max(a.cross.dComfort, a.disparity.dComfort, 5).toFixed(1);
  update();
};
$('fromCalib').title = `cross-eye cómodo ≤ ${LIMITS.crossComfortDeg}°`;
void fmtM;
update();
