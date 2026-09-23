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
| `1` `2` `3` / espacio | escena: Habitación · Fluido · Metaballs |
| `M` | siguiente modo estéreo: mono → parallel → cross → over/under → anaglyph |
| `S` | intercambiar ojos |
| `←` `→` | separación de ojos (profundidad). Shift = paso grande |
| `↑` `↓` | plano de convergencia (qué queda "en la pared") |
| `D` | mapa de profundidad (blanco cerca, negro lejos) |
| `P` | corner-pin: arrastrar las 4 esquinas para calzar la imagen en el mural |
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

GUI → "audio (mic / loopback)". Publica `audio:level`, `audio:bass`, `audio:mid`,
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
- **Depth look** (`look.depth`): cualquier escena como mapa de profundidad.

## Agregar una escena

Crear `src/scenes/MiEscena.js` extendiendo `BaseScene`, definir parámetros en
`defineParams()` con `this.p('nombre', {min, max, default})`, construir en
`build()`, animar en `update(dt, t)` y sumarla a `SCENES` en `src/core/App.js`.
