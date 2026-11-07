/**
 * Paletas de color. Cada una sale de mirar las referencias:
 *  eco      → "Echo Flux": piel violeta-azul, luz roja/magenta, ojos dorados
 *  cosmos   → "Cried Out": azul eléctrico, rojo-naranja, galaxia, destellos cian
 *  el resto son variaciones para recorrer con la música.
 *
 * shadow  sombra profunda de la piel       skin    tono medio (luz de relleno)
 * key     luz principal sobre la piel      rim     contraluz / borde
 * accent  oro / metales                    gem     brillo de las gemas
 * makeup  labios, sombra de ojos           hair    reflejo del pelo
 * bg0..2  fondo (oscuro → intenso)
 */
export const PALETTES = {
  eco:          { shadow: '#14063f', skin: '#5631e6', key: '#ff2d6a', rim: '#ff3ad8', accent: '#ffad2e', gem: '#ff2f55', makeup: '#ff1a3a', hair: '#4b4dff', bg0: '#04000f', bg1: '#2c0fa0', bg2: '#ff1f4f' },
  cosmos:       { shadow: '#040a44', skin: '#1f3fff', key: '#ff3b1a', rim: '#ffcf3a', accent: '#ffc83a', gem: '#38e6ff', makeup: '#ff2a12', hair: '#2f6bff', bg0: '#00000c', bg1: '#1234ff', bg2: '#ff3a10' },
  ultravioleta: { shadow: '#0e0026', skin: '#6a1fd6', key: '#b44dff', rim: '#36ff9e', accent: '#d8ff3a', gem: '#36ffd6', makeup: '#ff2fd2', hair: '#7a2bff', bg0: '#03000c', bg1: '#4a0fa6', bg2: '#22ffaa' },
  oro:          { shadow: '#03221f', skin: '#11806f', key: '#ffc35a', rim: '#fff0b0', accent: '#ffd36b', gem: '#30ffc0', makeup: '#ff7a2a', hair: '#1fbfa0', bg0: '#000805', bg1: '#0b4f46', bg2: '#e0a020' },
  fuego:        { shadow: '#1c0002', skin: '#8f0a1c', key: '#ff5c00', rim: '#ffd000', accent: '#ffe060', gem: '#ff2200', makeup: '#ff0030', hair: '#ff3a00', bg0: '#080000', bg1: '#6a0012', bg2: '#ff7a00' },
  nacar:        { shadow: '#2a2052', skin: '#ae98ff', key: '#ffd1f0', rim: '#9ff6ff', accent: '#fff3c4', gem: '#c4a4ff', makeup: '#ff6f9f', hair: '#9fb6ff', bg0: '#0a0818', bg1: '#5a4aa0', bg2: '#ffb0d8' },
};
export const PALETTE_NAMES = Object.keys(PALETTES);
export const PALETTE_KEYS = ['shadow', 'skin', 'key', 'rim', 'accent', 'gem', 'makeup', 'hair', 'bg0', 'bg1', 'bg2'];
