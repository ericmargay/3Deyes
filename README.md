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
| `1` … `9` | escena por número (todas en la lista de la GUI, agrupadas por categoría) · `[` `]` escena anterior / siguiente |
| espacio | reproduce / pausa la música (si hay tema); si no, siguiente escena |
| `A` | panel de música · `K` play/pausa · `J` / `L` ±5 s · `V` director de cámara (apagado por defecto: cada escena tiene su cámara fija) · `X` efectos al azar |
| `M` | siguiente modo estéreo: mono → parallel → cross → over/under → anaglyph → vr → left → right |
| `O` | dos proyectores: abre / cierra las salidas "ojo izquierdo" y "ojo derecho" |
| `S` | intercambiar ojos |
| `←` `→` | separación de ojos (profundidad). Shift = paso grande |
| `↑` `↓` | plano de convergencia (qué queda "en la pared") |
| `D` | mapa de profundidad (blanco cerca, negro lejos) |
| `P` | corner-pin: arrastrar las 4 esquinas para calzar la imagen en el mural |
| `C` | abre la página de calibración (distancia del público) |
| `E` | abre el editor de escenas |
| `Z` | pad Kaoss (X / Y táctil; también en otra ventana o con un Kaoss Pad real) |
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

- **left / right**: un solo ojo a cuadro completo (una salida por proyector).

### Dos proyectores (un ojo cada uno)

Para estéreo pasivo (dos proyectores con filtros polarizados sobre tela
plateada y anteojos polarizados), espejos tipo Wheatstone o dos murales:
tecla `O` (o GUI → conexiones → "dos proyectores"). Se abren dos ventanas,
**ojo izquierdo** y **ojo derecho**; la app renderiza una sola vez por cuadro
los dos ojos a la resolución de esas ventanas y copia cada uno a la suya, así
los dos proyectores muestran siempre el mismo instante. La ventana principal
queda como monitor (GUI y vista previa: `salidas.vista` = lado a lado,
anaglifo, izquierdo o nada).

- Llevar cada ventana a su proyector y hacer clic: pantalla completa. Con Chrome
  y el permiso de "administración de ventanas" se ubican solas en las otras
  pantallas.
- En cada salida: `P` corner-pin propio (arrastrar las 4 esquinas hasta que las
  dos imágenes se superpongan en la pared; `R` reset), `X` espejo horizontal
  (retroproyección o espejo), `S` intercambiar ojos, `H` ayuda.
- `salidas.brilloL` / `salidas.brilloR` igualan el brillo de los proyectores
  (los filtros polarizados no siempre pierden lo mismo).
- `?salidas=1` en la URL las abre al arrancar (permitir ventanas emergentes
  para el sitio).
- Con una sola computadora y dos salidas de video. Dos computadoras separadas,
  cada una con `stereo.mode=left` / `right`, también funcionan, pero no quedan
  sincronizadas cuadro a cuadro (parpadeos, mirada, partículas) y eso rompe la
  fusión: usarlo solo para pruebas.
- Para que las imágenes calcen, `stereo.focus` define qué queda en la pared:
  ahí las dos proyecciones coinciden exactamente.

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
4. **Reloj (tempo y fase):** en la misma salida IAC activar también **Sync**. Ableton
   manda el reloj MIDI (24 pulsos por negra, start / stop / posición). Las escenas
   que lo usan (Diosas: `diosas.ritmo.fuente = midi clock`) quedan en el tempo
   del set y arrancan en el compás 1 cuando se da play.
5. **Notas → objetos (en el acto):** las escenas que escuchan notas (Caleidoscopio)
   crean una pieza por cada Note On que llega. Un track de batería por el canal
   10 usa el mapa GM (36 bombo, 38 caja, 42/44/46 hats, 49/57 platillos); los
   demás canales son notas (la altura elige la pieza, su lugar y su color). Es
   la sincronía más directa: lo que suena en el set aparece en el mismo instante.

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

`tools/esp32/esp32_mirada.ino`: dos sensores ultrasónicos a los costados del
mural mandan `diosas.mirada.x` y `diosas.mirada.presencia` (las diosas siguen
con la mirada a quien pasa) y dos botones para tap tempo y parpadeo.

### Cámara web como sensor

GUI → conexiones → "cámara (sensor de presencia)". Sigue el movimiento frente a
la cámara (sin librerías, en baja resolución) y publica `cam:x`, `cam:y`,
`cam:motion`, `cam:presence`, asignables con learn. Ajustes en el grupo `cam`
(sensibilidad, espejo, memoria de presencia, suavizado).

### Audio en vivo

GUI → "audio (mic / loopback)" o el panel de música (`A`). Publica `audio:level`, `audio:bass`, `audio:mid`,
`audio:high` y `audio:beat`, asignables con learn a cualquier parámetro (por
ejemplo `blob.smoothK` con los graves, `fluid.burst` con el beat). Con un tema
cargado en el panel esas fuentes salen del análisis (exactas). Para tomar
el master de Ableton usar BlackHole / Loopback como dispositivo de entrada.
Las reglas del editor reciben además `beat` (con downbeat), `section` y `hit`
(banda y fuerza) desde la música.

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
- **Diosas** (`diosas.*`): retratos psicodélicos de mujeres de mundos
  espirituales, a partir de los videos de `References/`. Ver más abajo.
- **Live Fourier Cinestesia**: Árbol, Cintas, Partitura, Murmullo, Gelatina,
  Cimática, Escenario, Fluido sonoro, Rorschach, Caleidoscopio, Kaoss
  estrobo, Ferrofluido, Atractor y Cordillera, sincronizadas con el análisis
  completo del tema. Ver la sección siguiente.
- **Bloom** (`look.bloom`, umbral y radio): halo de luz por ojo, antes de la
  composición estéreo, así el neón funciona en cross, parallel y anaglifo.
- **Depth look** (`look.depth`): cualquier escena como mapa de profundidad.

## Live Fourier Cinestesia

Categoría de escenas que *escuchan todo el tema antes de dibujar*, como
visualinst.com, y lo recorren en 3D estéreo: lo que viene sale del mural hacia
el público y cae en el plano de la pared justo en el instante del golpe.
Entrada: un archivo de música (arrastrarlo a la ventana, o `?musica=tema.mp3`
desde `public/musica/`, carpeta local que no se publica), o en vivo.

### Análisis (`src/music/analysis.js`, corre en un worker en ~3 s)

1. STFT de 2048 muestras, 100 cuadros por segundo, ventana de Hann.
2. Por cuadro: energía y **flujo espectral en 5 bandas** (sub 25–150 Hz,
   grave-medio 150–800, medio 0.8–3 k, agudo 3–8 k, aire 8–17 k). El flujo
   compara cada bin con el máximo de sus vecinos en el cuadro anterior: ignora
   vibratos y barridos. Además 24 bandas de timbre, 12 clases de altura (croma)
   y sonoridad.
3. **Onsets** por banda: picos con umbral adaptativo; cada golpe tiene fuerza.
4. **Tempo**: autocorrelación de la envolvente de onsets; cada candidato suma
   cuánto se repite el patrón también a 1, 2 y 4 compases (evita el doble o
   la mitad del tempo), con preferencia suave alrededor de 118 bpm.
5. **Beats**: programación dinámica (Ellis) que elige la secuencia que mejor
   casa onsets y pulso estable. **Downbeats**: fase de 4 que acumula más
   acento grave y más cambio de timbre / armonía.
6. **Secciones**: huella por beat (timbre + croma) → matriz de auto-similitud
   → novedad con kernel en tablero (Foote) → límites en downbeats; las
   secciones parecidas comparten tipo (A, B, C…) y color.
7. **Notas**: STFT larga (8192, 25 cuadros/s), saliencia por semitono con suma
   armónica, supresión de octavas, seguimiento de ataque y fin.

`node tools/analizar.mjs tema.mp3 --png curvas.png --desde 60 --segundos 16`
imprime tempo, beats, secciones y notas, y dibuja las curvas con los beats
para verificar a ojo.

### Reproducción y sincronía

El tema suena por el AudioContext y la posición visual sale de su reloj (sin
deriva). `musica.latencia` adelanta o atrasa lo visual (proyectores). Todo lo
que ve una escena está en `cues` (`src/music/Cues.js`): beat y compás con
fase, sección, envolvente / golpe / pulso por banda, croma, notas activas, y
**lo que viene** (`upcoming`, `beatsAhead`, `notesAhead`) hasta
`fourier.anticipacion` segundos. El panel (`A`) muestra el mapa del tema:
secciones coloreadas, downbeats, kicks; clic para saltar.

### En vivo (mientras alguien toca)

`musica.fuente`: **mic / línea** (Ableton por BlackHole / Loopback) o
**pestaña** (audio de otra pestaña de Chrome: YouTube, YouTube Music, Spotify
web; elegir la pestaña y marcar "compartir audio"). `src/music/Live.js` corre
la misma STFT y el mismo flujo por bandas sobre el audio que entra: los
golpes se confirman con 30 ms de retraso, el tempo se re-estima cada segundo
sobre los últimos 8–10 s y los beats se predicen con la fase que mejor alinea
el pulso. Al principio no está enganchado; a los 4–8 s se acopla y de ahí
sigue el ritmo (y se re-engancha si cambia el tema). Si además llega el
**reloj MIDI de Ableton** (Sync en la salida IAC), el tempo y la fase son
exactos y el audio aporta solo los golpes. En vivo no hay anticipación (no
se conoce el futuro) ni notas transcriptas.

**YouTube:** el navegador no puede bajar el audio de un link. El panel abre
el video en otra pestaña y después se captura esa pestaña. Para analizar el
tema entero (con anticipación), bajarlo antes a `public/musica/` con
`yt-dlp -x --audio-format mp3 -o "public/musica/%(title)s.%(ext)s" URL`
(`brew install yt-dlp`).

### Escenas

- **Árbol**: el tema crece como un árbol. Tronco por la grilla de beats (nodo
  grande en el downbeat), grosor con el sub; cada sección tiene carril y
  color y el tronco se bifurca al cambiar; ramas por banda (kicks = anillos
  sobre el tronco, aire lo más afuera), largo = fuerza; los golpes que vienen
  se ven como puntos tenues y la rama crece hacia donde va a caer.
- **Cintas**: vuelo por cinco cables de luz, uno por banda; cada golpe es una
  cuenta que llega al "ahora" justo en el golpe y destella; aros en los beats.
- **Partitura**: las notas como arcos de seno (ancho = duración, altura =
  fuerza, color = clase de altura), pentagrama con beats y secciones, rosa
  polar de 12 pétalos con la armonía del instante, curva del espectro.
- **Murmullo**: bandada de 262 144 partículas en GPU que gira en cada beat,
  se inclina con el grave, se dispersa con los kicks, deja pasar una ola con
  las cajas y cambia de formación por sección.
- **Gelatina**: gelatina raymarcheada que se aplasta con el kick, se hincha
  con los 808 largos, tiembla con los medios y lanza gotas con cajas y
  platillos.
- **Cimática**: placa de Chladni. Cada nota excita un modo (n, m) y la arena
  (GPU) se junta en las líneas nodales: la armonía se vuelve figura. Los
  kicks sacuden la placa.
- **Escenario**: la sala del concierto a escala real (ver abajo).
- **Fluido sonoro**: un fluido de verdad (Navier–Stokes en GPU,
  `src/sim/Fluid.js`) en una pecera de vidrio. Cada elemento tiene su gesto:
  el bombo es un chorro desde el piso, el bajo humo desde las esquinas, la
  caja dos chorros que chocan, los platillos gotas que caen, las notas tinta
  del color de la nota a su altura; remolino en cada beat, lavado en cada
  sección. Cada banda tiñe a su profundidad y el humo tiene espesor por ojo.
  Simetría: ninguna, espejo o caleidoscopio de 3–12 pliegues (exacta).
  Arrastrar revuelve; el pad Kaoss es un pincel.
- **Rorschach**: una lámina colgada bajo una luz de galería. Las gotas caen
  sobre el pliegue con el bombo, la caja salpica, los agudos chorrean, los
  platillos rocían, las notas dejan tinta de color; la mancha respira en cada
  beat y **la lámina se pliega y se abre a tempo** (cada 1/2/4/8 compases o
  en la sección): al despegarse salen dedos y ojos de aire. Lámina nueva en
  cada sección (la vieja se cae). La tinta es un fluido viscoso con simetría
  exacta que se expande como una película prensada (difusión no lineal);
  se dibuja como tinta real: absorbe la luz, borde duro rasgado por la fibra,
  anillo oscuro y brillo mientras está fresca. Tintas: negro, negro y rojo,
  pastel, neón bajo luz negra. Arrastrar pinta.
- **Caleidoscopio**: un caleidoscopio de verdad (`src/sim/Kaleido.js`). Los
  espejos son paralelos al eje de la vista, como en el tubo: 2 espejos forman
  una roseta de 3–16 pliegues con un túnel hacia el fondo; 3 o 4 espejos
  repiten el dibujo hasta llenar el mural (triángulo equilátero, escuadra
  45°, cartabón 30-60°, cuadrado). Cada reflejo se ve sólo a través de su
  espejo (costuras nítidas), los reflejos tienen el estéreo exacto (z no
  cambia) y hasta los brillos son simétricos (la luz se calcula en la cámara
  de espejos). Adentro: gemas talladas, cristales, esquirlas, pétalos,
  estrellas y flores de lentejuela, cuentas, perlas, tubos, anillos,
  purpurina y agujas, sobre un fondo que también se refleja. Estilos: joyas
  (vidrio, metal y película fina), neón (contornos; se mezcla por máximo y no
  se quema), vitral (vidrios que se mezclan restando, sobre luz lechosa) y
  mosaico (facetas planas). **Sincronía:** cada pieza se programa con el
  análisis y aterriza exactamente en su golpe o su nota (medido: en el mismo
  cuadro del golpe): nace en una costura del espejo, viaja `llegada` beats y
  destella al llegar. Notas → piezas por registro, ubicadas por altura y
  coloreadas por el círculo de quintas; bombo → flor en el centro de los
  espejos y anillo que se abre; bajo → gema; caja → estrella; agudos →
  cristal; platillos → purpurina; compás → agujas sobre las costuras; beat →
  el tubo gira; sección → espejos, paleta (y estilo en auto). Con Ableton,
  las notas MIDI crean piezas en el acto (ver Control externo). Arrastrar gira
  el tubo, rueda cambia los espejos, clic suelta piezas; pad: X espejos, Y zoom.
- **Kaoss estrobo**: club con pared de 32 paneles estroboscópicos LED, barras
  de píxeles, cabezas móviles en el humo, piso espejo y público a contraluz.
  Se toca con el pad Kaoss (ver abajo); sin tocarlo, la música dispara sola.
- **Ferrofluido**: una gota de ferrofluido sobre un piso espejo, entre cajas
  de luz. El bajo es el imán (salen las púas), el bombo la hace saltar, la
  caja tuerce el panal, los platillos hacen temblar las puntas y las notas
  encienden púas de su color. Formas por sección: erizo, charco, gota.
- **Atractor**: la forma de onda dibujada como osciloscopio de fósforo en 3D
  (inmersión de Takens: s(t), s(t−τ), s(t−2τ)). Un tono es un anillo, un
  intervalo un nudo, el ruido una nube: la forma *es* el sonido. Banda
  filtrable (grave, medio, agudo), τ automático, modos Takens, estéreo XY y
  hélice; las curvas anteriores se hunden como persistencia del fósforo.
- **Cordillera**: líneas apiladas como la tapa de *Unknown Pleasures*, hechas
  del timbre del tema (24 bandas, grave al centro) con picos de los golpes y
  líneas ocultas. Lo que viene se ve adelante, el ahora brilla, el pasado se
  aleja; los cambios de sección llegan como una línea de color.

Cada escena trae su look (bloom, viñeta, grano, tinte) al entrar
(`fourier.lookEscena`). En estéreo lado a lado cada ojo es angosto y las
cámaras fijas abren el campo para no perder los costados
(`fourier.encuadre`: recortar · intermedio · ajustar al ancho).

Parámetros comunes: `fourier.*` (anticipación, umbral de golpes, intensidad,
unidades por beat, paleta, notas) y `director.*`: **director de cámara** tipo
FLUID con 11 planos (lateral, holandés, macro, amplio, giro, curva, pasarela,
persecución, inclinado, órbita, picado) que corta en el downbeat cada 1, 2 o 4
compases según la energía, elige un plano dramático al cambiar de sección y
hace punch-in en los kicks fuertes; caos, profundidad 3D y proporción de
cortes secos. `fx.*`: efectos por ojo (estela, caleidoscopio, prisma, viñeta,
grano, deriva de tono, giro, túnel); el director los cambia por sección si
`fx.auto`; `X` elige unos al azar.

### Triggers de audio (sin keyframes)

`src/music/Trigger.js`, grupo `trigger` en la GUI: cada trigger convierte una
característica de la música en un valor 0..1 con **ataque y liberación**, como
el "Audio Trigger" de Blender / TouchDesigner: fuente (banda sub…aire, rango
de Hz libre, golpe de una banda, beat cada N, compás, nota, sección,
sonoridad), umbral, ataque, liberación, probabilidad y tiempo mínimo entre
disparos. Vienen definidos `kick`, `bajo` (40–400 Hz), `caja`, `hats`, `beat`,
`compas`, `cielo` (kick fuerte), `seccion` y `voz`. Cada uno publica
`trig:<nombre>` en el bus: doble clic en cualquier parámetro de cualquier
escena y queda asignado. El panel de música los muestra como barras a la
derecha del mapa, para ver y afinar la sincronía.

### Pad Kaoss y luces estroboscópicas

`Z` muestra un pad XY tipo Kaoss Pad (Korg): mientras se toca, el efecto está
enganchado; al soltar se va (salvo `HOLD`). `⧉` lo abre en otra ventana
(tablet o segunda pantalla, con el proyector limpio). Con un Kaoss Pad real
por MIDI: asignar con learn CC12 → `kaoss.x`, CC13 → `kaoss.y`, CC92 →
`kaoss.toque`. Publica `kaoss:x`, `kaoss:y`, `kaoss:touch` en el bus. Cada
escena rotula qué hacen X e Y (pincel en Fluido y Rorschach, simetría en el
Caleidoscopio, imán en el Ferrofluido, τ en el Atractor…).

En **Kaoss estrobo** y en las luces (`src/stage/Kaoss.js`): **X** es la
velocidad cuantizada al beat (1/1 · 1/2 · 1/4 · 1/8 · 1/16 · 1/32), **Y** el
color (blanco → color de la sección → complementarios → arcoíris repartido →
arcoíris que corre) y `◀ ▶` el programa: estrobo, persecución, aleatorio,
espejo, ola, tartamudeo (redoble que se acelera mientras se sostiene),
filtro (X elige la banda: las luces siguen al sub, al bajo… al aire) y eco.
El mismo motor **toma las luces reales** del rig por Art-Net mientras se toca
el pad (`luces.kaoss`: con el pad · siempre · nunca).

> ⚠ **Luces estroboscópicas**: pueden provocar crisis en personas con
> epilepsia fotosensible. `estrobo.seguro` (activo por defecto) limita los
> destellos de campo completo a 3 por segundo (criterio WCAG 2.3.1) y los
> parciales a 8 por segundo. Si se desactiva, avisar al público.

### Escenario y luces (set real, Art-Net)

La escena **Escenario** es el set del concierto a escala real, con cámara
**frontal fija** (también público, lateral, cenital o el director). Predio
exterior de noche: el muro del mural al fondo con la proyección (renderiza
adentro otra escena, `escenario.contenido`), dos pabellones de chapa y
hormigón enfrentados con cables, cajas y carreteles, truss, humo, siluetas, y
un **piso mojado con charcos que refleja todo** (reflejo planar real, por
ojo). El **cielo entero destella con los graves** (trigger `cielo`), el
color de la sección tiñe la escena (`fx.tinte`), mapeo tonal ACES, bloom,
viñeta, grano. Si existe `public/modelos/escenario.glb` (un escaneo de
Sketchfab) reemplaza a los pabellones.

El **rig** (`src/stage/rig.js`: posiciones en metros, ip, universo y canal de
cada artefacto; editarlo para el set real): 4 barras de luz de área bajo los
techos (luces de área reales en el render), 10 tubos de LEDs direccionables
(60 px), 6 barras en el piso, 6 cabezas móviles con **haz volumétrico** en el
humo, 2 washes. La lógica sale de los triggers: las áreas siguen el `bajo` y
el `kick` y viran a blanco con la `caja`; en cada tubo un **cometa** recorre
el tubo por cada golpe grave que viene y llega a la pantalla justo en el
golpe, el tubo destella con el kick, un anillo corre con el beat y las hats
chispean; las barras del piso son un VU por banda; las cabezas cambian de
pose en el compás (cada 1 / 2 / 4 según la energía: público, cruzadas,
barrido), hacen estrobo con hats fuertes en secciones intensas y cambian al
cambiar de sección; los washes siguen el bajo. `luces.monocromo` lleva todo
al color de la sección. Lo mismo que se ve en el render sale por DMX.

**Salida Art-Net:** `npm run artnet-bridge` (WebSocket 8081 → UDP 6454) y
`luces.artnet` activado en la GUI. Cada tubo es un ESP32 con
`tools/esp32/esp32_artnet_leds.ino` (WiFi, universo propio, FastLED; si no
llega red respira solo, para los que van a batería). Las cabezas y washes van
a un nodo Art-Net→DMX común (7 y 4 canales por artefacto). Conviene un router
propio para el set, direcciones fijas 2.x.x.x (o las que asigne el router,
puestas en `rig.js`) y limitar el brillo de los tubos a batería.

## Diosas

Hasta cinco figuras en capas de profundidad (la principal en el plano del
mural, dos detrás y dos más lejos), sobre un cosmos: cúpula de mármol líquido
con remolino y galaxia, un disco espiral de partículas, cintas de luz que
giran alrededor de la cabeza (pasan por delante y por detrás de ella),
destellos que salen del mural y un mandala detrás de cada cabeza.

Todo es procedural, sin modelos externos:

- **Anatomía** (`src/scenes/diosas/anatomy.js`): cabeza y busto como funciones
  implícitas (SDF). Un worker las convierte en malla con *surface nets*, pega
  los vértices a la superficie y hornea oclusión ambiental y máscaras de
  maquillaje. `diosas.calidad` (baja / media / alta) cambia la resolución.
- **Ojos**: globo con shader propio (fibras del iris, collarete, pupila,
  limbo oscuro, refracción de la córnea que se desplaza con la vista, reflejo
  húmedo) y párpados móviles con pestañas y delineado. Parpadean, siguen la
  mirada y el párpado acompaña cuando miran abajo.
- **Pelo**: hebras que crecen con gravedad y colisión sobre la cabeza
  (`hair.js`): flequillo recto (corte hime) u ondas con raya al medio.
- **Joyería**: tocados `luna` (lágrima y luna creciente en la frente), `sol`
  (corona de rayos) y `espinas`; aros con péndulo que reaccionan al giro de la
  cabeza; gargantilla con abanico de gemas; pedrería en la prenda.
- **Piel**: iluminación de ilustración neón (sombra azul-violeta, luz
  magenta/roja, contraluz), maquillaje que brilla y un flujo psicodélico con
  líneas doradas que corre sobre la piel.

**Controles** (GUI → `diosas`, en subcarpetas; todos asignables a MIDI / OSC / ESP32 / audio):

| grupo | qué controla |
|---|---|
| `diosas.ritmo` | fuente del tempo: `interno` (bpm), `midi clock` (Ableton) o `audio` (beat detectado); `beat` = tap tempo; destello en cada beat; cuánto reaccionan al audio |
| `diosas.movimiento` | gesto: respiración, trance, mirada, inclinación, oráculo, perfil, danza, serpiente. Están escritos en beats (quedan en tempo). Cambio automático cada N compases, transición, intensidad, velocidad × tempo, desfase entre figuras (0 = coro sincronizado), labios entreabiertos, boca que sigue el audio |
| `diosas.mirada` | a quién miran: `espectador` (a la cámara: te siguen en estéreo), `puntero`, `sensor` (`mirada.x` / `mirada.y`), `cámara` (cámara web), `deriva`, `entre ellas`, `cielo`. `presencia` mezcla entre trance (0) y mirarte (1): pensado para un sensor. Cuánto acompaña la cabeza, velocidad, microsacadas, parpadeos por minuto, `parpadear`, apertura de párpados |
| `diosas.ojos` | color del iris y del anillo interior, saturación, brillo (los ojos se encienden), pupila y pupila que late con el bajo, tamaño del iris, esclerótica blanca / negra / de color, heterocromía, variación entre diosas |
| `diosas.color` | paleta (`eco`, `cosmos`, `ultravioleta`, `oro`, `fuego`, `nacar`), siguiente, cambio cada N compases, transición, rotación y ciclo de tono al ritmo, saturación, brillo, contraluz, maquillaje |
| `diosas.piel` / `pelo` / `joyas` / `fondo` / `camara` | flujo psicodélico y líneas doradas; peinado, balanceo, pelo que flota; tocado, brillo de gemas, mandala; mármol, galaxia, remolino, cintas, destellos; distancia, altura, fov, deriva, paralaje, zoom en el beat |

**Con Ableton:** activar Sync en la salida IAC, elegir `diosas.ritmo.fuente = midi clock`
y dar play: los gestos, el destello de cada beat y los cambios por compás quedan
en fase con el set. Para disparar cosas puntuales desde clips, asignar notas
con learn (doble clic en `movimiento.siguiente`, `color.siguiente`,
`mirada.parpadear`… y tocar la nota). Para que muevan los labios con una voz,
mandar esa pista por BlackHole y subir `movimiento.bocaAudio`.

**Con sensores:** `mirada.modo = sensor` y mandar `diosas.mirada.x`,
`diosas.mirada.y`, `diosas.mirada.presencia` (ESP32, OSC desde TouchDesigner /
Kinect / MediaPipe); o `mirada.modo = cámara` con la cámara web. Sin nadie
enfrente las diosas quedan en trance; cuando alguien se acerca giran a mirarlo.

**Modelo GLB provisorio** (`diosas.modelo.*`): si existe
`public/modelos/diosa.glb` (carpeta ignorada por git, no se publica) o se elige
un archivo con `modelo.cargar` (queda guardado en el navegador), las diosas usan
ese modelo en lugar de la anatomía procedural. El esqueleto se detecta por los
pesos de piel (cabeza, cuello, ojos, brazos), así que funciona aunque los
nombres de los huesos vengan rotos. Los movimientos, la mirada (huesos de los
ojos) y el color de iris se aplican igual; `modelo.neon` re-ilumina las
texturas con la paleta, `modelo.brazos` baja los brazos de una pose T / A,
`escala` / `altura` / `adelante` ajustan el encuadre, `modelo.joyas` mantiene
los tocados procedurales. Sin morphs no hay parpadeo ni boca. El HUD muestra
el crédito que trae el archivo: si la licencia es CC-BY, poner ese crédito en
la obra. `modelo.usar` apagado vuelve a la anatomía procedural.

**Estéreo:** la cara principal está a 10 unidades, igual que la convergencia
por defecto (`stereo.focus = 10`), así queda en el plano del mural; el fondo
entra y los destellos cercanos salen. Para murales usar cross o anaglifo.

## Agregar una escena

Crear `src/scenes/MiEscena.js` extendiendo `BaseScene`, definir parámetros en
`defineParams()` con `this.p('nombre', {min, max, default})`, construir en
`build()`, animar en `update(dt, t)` y sumarla a `SCENES` en `src/core/App.js`
(y a `SCENE_CLASSES` en `src/editor.js`). Un id con tres partes
(`diosas.mirada.modo`) aparece en una subcarpeta de la GUI.

Una escena musical extiende `MusicScene` (`src/scenes/music/`) y se suma a
`MUSIC_SCENES` en `src/scenes/music/index.js` (entra sola en la app y en el
editor). Lee `this.cues` (beats, bandas, notas, secciones), define su cámara
fija en `this.fixed`, su look en `this.look`, los rótulos del pad en
`this.padLabels`, y termina `update()` con `this.finish(dt)`. Piezas
reutilizables: `src/sim/Fluid.js` (fluido 2D con simetría), `src/sim/Kaleido.js`
(cámara de espejos de caleidoscopio), `src/stage/WetFloor.js` (piso que refleja),
`src/stage/Beam.js` (haz en el humo), `src/stage/Kaoss.js` (motor de luces).
