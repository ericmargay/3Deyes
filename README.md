# 3Deyes

Instalación audiovisual en Three.js para **visión estereoscópica libre**
(parallel view / cross-eye view), **anaglifos** y proyección sobre murales.
Escenas 3D con física, fluidos en GPU y shaders, controlables en vivo desde
**ESP32** (serial), **Ableton Live** (MIDI u OSC), audio en vivo o la GUI.

```
npm install
npm run dev        # http://localhost:5173  (abrir en Chrome/Edge para MIDI y Serial)
npm run build      # genera dist/ para la instalación
npm run osc-bridge # opcional: OSC udp:9000 → ws:8080
```

## Teclas

| Tecla | Acción |
|---|---|
| `1` `2` `3` `4` / espacio | escena: Habitación · Fluido · Metaballs · Track |
| `M` | siguiente modo estéreo: mono → parallel → cross → over/under → anaglyph |
| `S` | intercambiar ojos |
| `←` `→` | separación de ojos (profundidad). Shift = paso grande |
| `↑` `↓` | plano de convergencia (qué queda "en la pared") |
| `D` | mapa de profundidad (blanco cerca, negro lejos) |
| `P` | corner-pin: arrastrar las 4 esquinas para calzar la imagen en el mural |
| `C` | abre la página de calibración (distancia del público) |
| `E` | abre el editor de escenas |
| `G` / `H` | mostrar GUI / ayuda |
| `F` | pantalla completa |
| `R` | reset de los parámetros de la escena actual |

## Cómo funciona el estéreo

`src/output/StereoOutput.js` deriva de la cámara de cada escena dos cámaras
*off-axis* (`THREE.StereoCamera`) separadas `stereo.eyeSep` y convergiendo en
`stereo.focus`. Cada ojo se renderiza a una textura y un shader las compone:

- **parallel**: izquierda a la izquierda. El espectador mira "a través" de la pared.
- **cross**: ojos intercambiados. El espectador cruza la vista delante de la pared.
- **anaglyph**: mezcla rojo-cian con matrices de Dubois (o color simple / gris).
- `stereo.scale` y `stereo.gap` achican / separan las imágenes; `stereo.fusionDots`
  dibuja un punto sobre cada imagen (al fusionar se ven tres puntos).

### Consideraciones para murales enormes

- **Parallel view no funciona a gran escala.** Para fusionar en paralelo, los
  centros de las dos imágenes tienen que estar a menos de ~6.5 cm (la distancia
  entre los ojos), porque el ojo no puede divergir. En un mural las imágenes
  están a metros: es físicamente imposible. En proyección grande usar:
  - **cross-eye** (funciona a cualquier tamaño; cuanto más lejos el público,
    más cómodo), o
  - **anaglyph** con lentes rojo-cian, o
  - **parallel** sólo si el público mira desde muy lejos o a través de un
    visor / pantalla chica (impresiones, tablets).
- Con imágenes grandes bajar `stereo.scale` (0.5–0.7) y subir `stereo.gap`
  ayuda a que la gente fusione más fácil en cross-eye.
- `stereo.eyeSep` es en unidades de escena, no en cm: ajustarlo a ojo hasta que
  la profundidad sea cómoda (disparidad en pantalla ≈ 1–3 % del ancho). Más
  separación = más profundidad pero más gente que no fusiona.
- Todo lo que está más cerca que `stereo.focus` "sale" del mural; más lejos, "entra".
- Corner-pin (`P`) corrige un proyector en ángulo o una pared que no es plana
  rectángulo. Se guarda en localStorage del navegador.
- Rendimiento: `look.pixelRatio` baja la resolución interna si el proyector es 4K.

## Calibración 3D: ¿a qué distancia tiene que estar el público?

`http://localhost:5173/calibrate.html` (o tecla `C` desde la app). Es un
escenario 3D a escala real, al estilo CineShader: una nave oscura con piso
reflectante, el mural con el tamaño físico medido, una silueta humana parada a
la distancia calculada y la geometría de vergencia dibujada en el espacio.

**Medir el mural.** Poner la página a pantalla completa en el proyector con el
contenido "patrón": la barra roja mide exactamente el 50 % del ancho del canvas.
Medirla con cinta en la pared y cargar el valor en `medidas.barraCm`. Con eso y
la resolución del proyector la página conoce metros por píxel.

**Lo que muestra el escenario.**
- El mural con lo que saldría del proyector: un shader estilo Shadertoy con
  relieve 2.5D (rgb = color, alpha = altura, oclusión automática, convención
  CineShader), el patrón de calibración, o una escena real de la app.
- Zonas en el piso: rojo (demasiado cerca), amarillo (funciona), verde (cómodo),
  con marcas cada metro. Siluetas fantasma en la distancia mínima y la cómoda.
- Líneas ojo → imagen con el punto de convergencia (cross-eye), y los objetos
  virtuales: dónde queda en el espacio el objeto más cercano de la escena y el
  fondo, con la diferencia de vergencia en grados.
- Vistas: general, **desde el público** (la cámara en los ojos del espectador),
  lateral y cenital (teclas 1–4).

**Cálculos** (`src/core/StereoMath.js`, umbrales en `LIMITS`):
- **cross-eye**: distancia mínima (convergencia ≤ 15°) y cómoda (≤ 8°),
- **parallel**: viable si la separación de centros ≤ IPD; si no, qué distancia haría falta,
- **anaglifo / disparidad**: distancia para que la diferencia de vergencia entre
  la pared y el objeto más cercano sea ≤ 1.5° (≤ 1° cómodo),
- **eyeSep máximo** para que el fondo no obligue a divergir (paralaje ≤ IPD).

**Shader del mural.** Tecla `E` abre el editor: pegar cualquier `mainImage`
de Shadertoy (sin texturas ni buffers), compilar, y queda guardado en el
navegador. Presets: ripple, turbulence, domain, grid.

**Botones** (carpeta "conexiones"): guardar calibración (la app la usa para
mostrar la distancia del público en el HUD), aplicar estéreo y escenas a la
app, usar eyeSep máximo. Todos los parámetros de la página están en el mismo
bus que la app, así que también se pueden mover desde MIDI, ESP32 u OSC.

## Editor de escenas

`http://localhost:5173/editor.html` (o tecla `E` desde la app). Las escenas son
las plantillas: el editor guarda encima un **proyecto** que la app reproduce.
Se puede editar en una ventana mientras la app proyecta en otra: la app recarga
el proyecto en cuanto se guarda.

**Paneles.**
- *Objetos*: árbol de la escena (mallas, luces, grupos, partículas). Ojo para
  ocultar. Clic para seleccionar; en el viewport también.
- *Parámetros*: todos los parámetros de la escena, la salida estéreo y el look,
  con doble clic para asignar un control físico.
- *Viewport*: cámara orbital propia, gizmo mover / rotar / escalar (W / E / R),
  enfocar (F), "animar" para que la escena siga viva mientras se edita.
  Modo **reproducir** (Tab): se ve exactamente la salida de la app, con el
  modo estéreo elegido, y los clics y teclas disparan las reglas.
- *Inspector*: transformación y material del objeto seleccionado, con ◆ para
  grabar un keyframe de cada propiedad; edición del keyframe o cue elegido.
- *Línea de tiempo*: pistas de parámetros (`param:room.hue`) u objetos
  (`obj:decoración/nudo:position.y`), keyframes con curva (linear, smooth,
  easeIn, easeOut, step), cues que disparan acciones, grilla de beats con imán,
  loop, duración y auto-play en la app. **● grabar**: cada parámetro u objeto
  que se mueve crea keyframes en el tiempo actual.
- *Interacciones*: reglas "cuando → entonces". Disparadores: clic en objeto,
  tecla, control físico (MIDI, OSC, serial, audio), beat, portal atravesado,
  objeto activado, entrar a la escena, parámetro que supera un valor. Acciones:
  fijar o animar un parámetro, alternar, disparar un trigger, cambiar de escena,
  reproducir / pausar / detener / ir a un tiempo de la línea de tiempo.
- *Conexiones*: tabla fuente → parámetro con mapeo (min, max, invertir,
  suavizado) y learn.

- *+ agregar*: primitivas (cubo, esfera, cilindro, toro, cono, pirámide,
  icosaedro, dodecaedro, nudo, plano, cápsula), luces (puntual, direccional,
  foco, ambiente) y texto. Se guardan en el proyecto y aparecen en la app.
- *Material*: tipo (Standard, Physical, Basic, Toon, Lambert), color, emisivo,
  rugosidad, metal, barniz, transmisión, opacidad, wireframe, facetado, lados,
  textura desde imagen (se guarda en el proyecto, máx. 1024 px) y sombras.
- *Escena* (sin selección): fondo, niebla, exposición, bloom, profundidad y
  los parámetros estéreo principales.
- *Eventos* por objeto: "+ al hacer clic" crea una regla para ese objeto.
  Las reglas también pueden fijar, animar o alternar propiedades de objetos.
- Deshacer / rehacer (Ctrl+Z / Ctrl+Shift+Z), duplicar, borrar objetos
  agregados, encuadrar toda la escena (Inicio).

**Presets**: guardan los parámetros de la escena con un nombre. **Exportar /
importar** mueven el proyecto como JSON. Todo se persiste en el navegador.

El modelo vive en `src/editor/Project.js`; `Timeline.js` y `Rules.js` son los
motores que corren tanto en el editor como en la app.

## Teléfono + visor VR

Al abrir la app en un teléfono aparece un aviso: "Entrar al modo visor" pone
el modo estéreo `vr`, oculta la interfaz, pide pantalla completa y giroscopio,
y parte la pantalla en dos imágenes centradas bajo las lentes del visor
(Cardboard, Gear VR usado como montura, etc.). Parámetros en `stereo.vr*`:
separación de lentes (mm), ancho físico de la pantalla (mm; 154 para el iPhone
15 Pro Max en horizontal), fov, tamaño de imagen y distorsión k1/k2 que
compensa las lentes. El giroscopio mueve la mirada en Track; "recentrar"
vuelve a tomar el frente. iOS no permite pantalla completa desde Safari:
agregar la página a la pantalla de inicio la abre sin barras.

## Estereoscopio para el mural

`http://localhost:5173/visor.html`: diseño de construcción de un periscopio de
espejos (Wheatstone / Schilling) que lleva cada ojo directo al centro de su
imagen, para quien no logra fusionar a ojo desnudo. Con el mural medido y la
distancia del público calcula la desviación por ojo, el ángulo de los espejos
externos (45° menos la mitad de la desviación), los tamaños de espejo según el
campo visual, la alternativa en anteojos prismáticos (dioptrías prismáticas por
ojo, base interna para cross o externa para parallel), un plano en planta a
escala, la lista de piezas y los pasos de armado sobre un visor VR sin lentes.
Espejos de primera superficie obligatorios: los comunes producen una imagen
fantasma que arruina el estéreo.

## Control externo

Todos los parámetros viven en `src/core/Params.js` y tienen id `grupo.nombre`
(`stereo.eyeSep`, `fluid.curl`, `room.gravity` …). En la GUI se ve el id al
pasar el mouse por un parámetro.

**Asignar un control físico:** doble clic en el nombre del parámetro en la GUI
(queda en rosa, "LEARN" en el HUD) y mover el knob / CC / potenciómetro. Clic
derecho quita la asignación. Las asignaciones se guardan en localStorage.

### Ableton Live → MIDI (más directo)

1. macOS: Audio MIDI Setup → IAC Driver → activar. Ableton → Preferences → Link/MIDI → Output "IAC Driver Bus 1": Track ✔.
2. Un track MIDI con salida a IAC y clips con envolventes de CC (o mapear knobs del controlador con el MIDI Out).
3. En el navegador: GUI → conexiones → "MIDI (Ableton)". Learn y listo.

### Ableton Live / Max / TouchDesigner → OSC

`npm run osc-bridge` escucha OSC en `udp://0.0.0.0:9000` y lo manda por WebSocket.
En la GUI → "WebSocket / OSC".

```
/3deyes/fluid.curl 8.0        → valor real del parámetro
/3deyes/stereo.mode 2         → índice en las opciones (0 mono, 1 parallel, 2 cross, 3 overunder, 4 anaglyph)
/3deyes/room.explode 1        → dispara un trigger
/knob1 0.4                    → fuente "osc:/knob1", asignable con learn
```

### ESP32 → Serial

Sketch en `tools/esp32/esp32_params.ino`. Manda líneas `k0 0.53` (0..1) por USB a
115200 baudios. GUI → "serial (ESP32)" → elegir el puerto. Las fuentes se
llaman `serial:k0`, `serial:b0`… y se asignan con learn. También acepta
`fluid.curl 0.5` (id directo, normalizado) o JSON `{"k0":0.5}`.

### Audio en vivo

GUI → "audio (mic / loopback)" o "audio: archivo de música" (mp3/wav en loop). Publica `audio:level`, `audio:bass`, `audio:mid`,
`audio:high` y `audio:beat`, asignables con learn a cualquier parámetro (por
ejemplo `blob.smoothK` con los graves, `fluid.burst` con el beat). Para tomar
el master de Ableton usar BlackHole / Loopback como dispositivo de entrada.

## Escenas

- **Habitación** (`room.*`): rincón isométrico pastel con objetos que caen (cannon-es).
  Gravedad, viento, rebote, tasa de aparición, explosión, colores, cámara orbital.
- **Fluido** (`fluid.*`): hasta 262 144 partículas en GPU movidas por curl noise,
  atracción a una esfera, remolino, ráfaga, color por velocidad.
- **Metaballs** (`blob.*`): superficies fluidas raymarcheadas con fusión suave,
  ondulación por ruido, piso, luz. El estéreo es exacto porque los rayos salen
  de la proyección de cada ojo.
- **Track** (`track.*`): viaje por un túnel neón (inspirado en TRACK de Little
  Workshop). La cámara recorre un circuito cerrado de ~1 km; los objetos de
  cuerpo oscuro y bordes de luz aparecen al ritmo y pasan de largo; cada N beats
  un portal que destella al atravesarlo. El ritmo sale del reloj interno
  (`track.bpm`), del beat del audio (desactivar `autoBeat`, conectar audio o
  cargar un archivo de música) o del trigger `track.beat` (MIDI / OSC / ESP32).
  El mouse mira alrededor; el objeto que queda en el centro se activa con clic
  o con `track.hit`: destella, gira y se aparta. `track.reverse` invierte el
  sentido. Sección cuadrada, octogonal o circular, radio, anillos, colores,
  intensidad neón, niebla, partículas. `track.pulse` es asignable al audio
  (por ejemplo `audio:bass`) para que el túnel respire con la música.
- **Bloom** (`look.bloom`, umbral y radio): halo de luz por ojo, antes de la
  composición estéreo, así el neón funciona en cross, parallel y anaglifo.
- **Depth look** (`look.depth`): cualquier escena como mapa de profundidad.

## Agregar una escena

Crear `src/scenes/MiEscena.js` extendiendo `BaseScene`, definir parámetros en
`defineParams()` con `this.p('nombre', {min, max, default})`, construir en
`build()`, animar en `update(dt, t)` y sumarla a `SCENES` en `src/core/App.js`.
