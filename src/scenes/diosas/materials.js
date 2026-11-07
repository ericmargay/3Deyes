import * as THREE from 'three';
import { simplexNoise3D } from '../../shaders/noise.glsl.js';

/**
 * Materiales de las diosas. La piel, los ojos y el pelo son shaders propios
 * con una iluminación "de ilustración neón": sombra profunda azul-violeta,
 * luz principal roja/magenta, contraluz fuerte y maquillaje que brilla, como
 * en las referencias. Todos comparten los uniforms de paleta y luces, así un
 * cambio de color (o el ciclo al ritmo) llega a todo de una vez.
 */

export function sharedUniforms() {
  const c = () => ({ value: new THREE.Color() });
  return {
    uTime: { value: 0 }, uPulse: { value: 0 },
    cShadow: c(), cSkin: c(), cKey: c(), cRim: c(), cAccent: c(), cGem: c(), cMakeup: c(), cHair: c(), cBg0: c(), cBg1: c(), cBg2: c(),
    uKeyDir: { value: new THREE.Vector3(-0.55, 0.4, 0.75).normalize() },
    uFillDir: { value: new THREE.Vector3(0.85, -0.05, 0.4).normalize() },
    uRimDir: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
    uRimAmt: { value: 1.2 }, uGlow: { value: 1 }, uMakeupAmt: { value: 1 },
    uFlow: { value: 0.25 }, uFlowFace: { value: 0.3 }, uFlowScale: { value: 1.6 }, uFlowSpeed: { value: 0.5 }, uLines: { value: 0.6 },
    uSway: { value: 1 }, uFloat: { value: 0 },
  };
}

/** Uniforms propios de cada figura (cuello flexible, boca, aparición). */
export function figureUniforms() {
  return { uNeckInv: { value: new THREE.Matrix3() }, uPivot: { value: new THREE.Vector3() }, uShift: { value: new THREE.Vector3() }, uMouth: { value: 0 }, uFade: { value: 1 } };
}

const common = /* glsl */ `
  uniform float uTime, uPulse, uRimAmt, uGlow, uFade;
  uniform vec3 cShadow, cSkin, cKey, cRim, cAccent, cGem, cMakeup, cHair;
  uniform vec3 uKeyDir, uFillDir, uRimDir;
  vec3 loop4(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    t = fract(t) * 4.0; float f = fract(t); f = f * f * (3.0 - 2.0 * f);
    if (t < 1.0) return mix(a, b, f); if (t < 2.0) return mix(b, c, f); if (t < 3.0) return mix(c, d, f); return mix(d, a, f);
  }
`;

// ---------------------------------------------------------------- piel
const skinVert = /* glsl */ `
  attribute float ao;
  attribute vec4 masks;
  uniform mat3 uNeckInv; uniform vec3 uPivot, uShift; uniform float uNeck, uMouth;
  varying vec3 vPosL, vPosW, vNrmW; varying float vAo; varying vec4 vMasks;
  void main() {
    vec3 p = position, n = normal;
    // labios entreabiertos: baja el labio inferior y el mentón
    float jaw = uMouth * uNeck * smoothstep(-0.652, -0.69, p.y) * smoothstep(0.1, 0.55, p.z)
              * (1.0 - smoothstep(0.2, 0.48, abs(p.x))) * (1.0 - smoothstep(-0.95, -1.25, p.y));
    p.y -= jaw * 0.07; p.z -= jaw * 0.02;
    // cuello flexible: la parte baja del cuello queda alineada con el busto
    float w = uNeck * smoothstep(-1.0, -1.6, p.y);
    p = mix(p, uPivot + uNeckInv * (p - uPivot - uShift), w);
    n = normalize(mix(n, uNeckInv * n, w));
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vPosW = wp.xyz; vPosL = position; vNrmW = normalize(mat3(modelMatrix) * n);
    vAo = ao; vMasks = masks;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const skinFrag = /* glsl */ `
  ${common}
  ${simplexNoise3D}
  uniform float uKind, uFlow, uFlowFace, uFlowScale, uFlowSpeed, uLines, uMakeupAmt;
  varying vec3 vPosL, vPosW, vNrmW; varying float vAo; varying vec4 vMasks;

  float ridge(vec3 p) { return 1.0 - abs(snoise(p)); }

  // cejas finas y delineado en "ala" (se calculan por fragmento: son más finos que la malla)
  float browMask(vec3 p) {
    float bx = abs(p.x) - 0.3;
    float by = p.y - 0.25 - 0.055 * cos(bx * 4.2) + bx * 0.12;
    float th = 0.008 + 0.016 * (1.0 - smoothstep(-0.14, 0.18, bx));
    float hairs = 0.75 + 0.25 * sin(p.x * 260.0 + p.y * 90.0);
    return (1.0 - smoothstep(th * 0.5, th, abs(by))) * (1.0 - smoothstep(0.16, 0.23, abs(bx))) * smoothstep(0.5, 0.62, p.z) * hairs;
  }
  float wingMask(vec3 p) {
    vec2 a = vec2(0.445, 0.04), b = vec2(0.6, 0.13);
    vec2 q = vec2(abs(p.x), p.y), pa = q - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float w = mix(0.02, 0.002, h);
    return (1.0 - smoothstep(w * 0.6, w, length(pa - ba * h))) * smoothstep(0.38, 0.5, p.z);
  }

  void main() {
    vec3 N = normalize(vNrmW);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vPosW);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float kd = dot(N, uKeyDir), fd = dot(N, uFillDir), rd = dot(N, uRimDir);
    float key = smoothstep(0.2, 0.95, kd);
    float fill = smoothstep(-0.45, 0.8, fd);
    bool body = uKind > 0.5;
    float lips = body ? 0.0 : vMasks.x, lidM = body ? 0.0 : vMasks.y, blush = body ? 0.0 : vMasks.z, third = body ? 0.0 : vMasks.w;
    float brow = body ? 0.0 : max(browMask(vPosL), wingMask(vPosL) * uMakeupAmt);

    vec3 col = cShadow * 0.6;
    col = mix(col, cSkin * 0.8, fill * 0.85 + 0.08 * smoothstep(-0.5, 0.5, kd));
    col = mix(col, cKey * 0.85, key * 0.8);
    // terminador más saturado (sensación de piel translúcida)
    col += cKey * smoothstep(0.0, 0.3, kd) * (1.0 - smoothstep(0.3, 0.65, kd)) * 0.22;
    col *= mix(0.3, 1.0, vAo);
    // textura fina de piel (evita el aspecto de plástico)
    col *= 0.94 + 0.06 * snoise(vPosL * 55.0) + 0.03 * snoise(vPosL * 9.0);

    // maquillaje
    col = mix(col, cMakeup * (0.3 + 0.9 * key + 0.3 * fill), lips * 0.92 * uMakeupAmt);
    col = mix(col, cMakeup * (0.4 + 0.9 * key), lidM * 0.8 * uMakeupAmt);
    col += cMakeup * lidM * lidM * uGlow * 0.4 * uMakeupAmt * (0.8 + 0.4 * uPulse);
    col = mix(col, cKey * 0.9, blush * 0.25 * uMakeupAmt);
    col = mix(col, cShadow * 0.12, brow * 0.9);
    col += cGem * third * uGlow * (0.15 + 0.85 * uPulse) * 0.8;

    // flujo psicodélico sobre la piel
    float flowAmt = body ? uFlow : uFlow * uFlowFace;
    if (flowAmt > 0.001) {
      vec3 q = vPosL * uFlowScale;
      float tt = uTime * uFlowSpeed;
      vec3 w = q + 0.9 * vec3(snoise(q * 0.7 + vec3(0.0, tt * 0.3, 0.0)), snoise(q * 0.7 + vec3(7.1, -tt * 0.25, 3.3)), snoise(q * 0.7 + vec3(-4.2, 1.7, tt * 0.2)));
      float n = snoise(w * 1.1 + vec3(0.0, 0.0, tt * 0.4));
      vec3 fc = loop4(n * 0.55 + tt * 0.08, cSkin, cKey, cAccent, cGem) * (0.15 + 0.8 * key + 0.35 * fill) * mix(0.2, 1.0, vAo);
      float iso = abs(fract(n * 4.0 + tt * 0.15) - 0.5);
      float lines = 1.0 - smoothstep(0.0, 0.06, iso);
      col = mix(col, fc, flowAmt * (1.0 - lips * 0.8));
      col += cAccent * lines * uLines * flowAmt * (0.9 + uPulse) * (0.3 + 0.7 * max(key, fill));
    }

    // busto: prenda bordada y filigrana dorada (henna) sobre la piel
    if (body) {
      float g = vMasks.x, fil = vMasks.y;
      vec2 uvg = vec2(atan(vPosL.x, vPosL.z + 0.8) * 3.0, vPosL.y * 2.2);
      float orn = ridge(vec3(uvg * 2.2, 0.5)) ;
      float orn2 = ridge(vec3(uvg * 5.0, 2.0));
      vec3 cloth = cShadow * 0.15 + cSkin * 0.06 * fill + cRim * pow(1.0 - ndv, 2.0) * 0.2;
      vec3 gold = cAccent * (0.15 + 0.9 * max(key, fill * 0.6));
      cloth = mix(cloth, gold, smoothstep(0.94, 0.985, orn) + 0.6 * smoothstep(0.95, 0.99, orn2));
      vec2 cell = floor(uvg * 26.0);
      float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
      float seq = step(0.93, h) * pow(0.5 + 0.5 * sin(uTime * 4.0 + h * 40.0), 4.0);
      cloth += mix(cGem, cAccent, h) * seq * 1.2;
      col = mix(col, cloth, g);
      float hen = smoothstep(0.9, 0.97, ridge(vec3(vPosL.xy * 7.0, vPosL.z * 3.0)));
      col += cAccent * hen * fil * 0.9 * (0.4 + key);
    }

    // contraluz
    float rim = pow(1.0 - ndv, 3.0);
    col += cRim * rim * uRimAmt * (0.35 + 0.65 * smoothstep(-0.3, 0.6, rd));
    // especular (labios húmedos)
    vec3 H = normalize(uKeyDir + V);
    float sp = pow(max(dot(N, H), 0.0), mix(28.0, 80.0, lips));
    col += (cKey * 0.5 + 0.5) * sp * (0.06 + lips * 1.1) * max(key, 0.35 * fill);

    gl_FragColor = vec4(col * uFade, 1.0);
  }
`;

export function skinMaterial(U, F, kind = 'head') {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, ...F, uKind: { value: kind === 'body' ? 1 : 0 }, uNeck: { value: kind === 'head' ? 1 : 0 } },
    vertexShader: skinVert, fragmentShader: skinFrag,
    side: kind === 'lid' ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.name = `piel (${kind})`;
  return m;
}

// ---------------------------------------------------------------- ojos
const eyeVert = /* glsl */ `
  varying vec3 vDir, vPosW, vNrmW, vViewL;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    mat3 R = mat3(modelMatrix);
    vNrmW = normalize(R * normal);
    vViewL = transpose(R) * (cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const eyeFrag = /* glsl */ `
  ${common}
  ${simplexNoise3D}
  uniform vec3 uIris1, uIris2, uSclera;
  uniform float uIrisSize, uPupil, uEyeGlow, uSeed;
  varying vec3 vDir, vPosW, vNrmW, vViewL;
  void main() {
    vec3 d = normalize(vDir);
    vec3 N = normalize(vNrmW), V = normalize(cameraPosition - vPosW), vl = normalize(vViewL);
    float front = step(0.0, d.z);
    // refracción de la córnea: el iris está hundido y se desplaza con la vista
    float r0 = length(d.xy) / uIrisSize;
    float inI = (1.0 - smoothstep(0.95, 1.1, r0)) * front;
    vec2 q = d.xy - vl.xy * 0.17 * max(0.0, 1.0 - r0 * r0) * inI;
    float r = length(q) / uIrisSize;
    float ang = atan(q.y, q.x);
    vec2 cs = vec2(cos(ang), sin(ang));
    float fib = 0.6 * snoise(vec3(cs * 13.0, r * 2.2 + uSeed)) + 0.4 * snoise(vec3(cs * 31.0, r * 4.5 + 3.0 + uSeed));
    fib = fib * 0.5 + 0.5;
    float pr = uPupil;
    float coll = pr + 0.2 + 0.06 * snoise(vec3(cs * 3.0, 1.7 + uSeed));
    vec3 iris = mix(uIris2, uIris1, smoothstep(coll - 0.1, coll + 0.12, r));
    iris *= 0.35 + 0.6 * fib;
    float crypt = smoothstep(0.55, 0.8, snoise(vec3(cs * 7.0, r * 5.0 + uSeed * 2.0)));
    iris *= 1.0 - crypt * 0.45 * smoothstep(coll, coll + 0.1, r);
    iris = mix(iris, iris * 0.18, smoothstep(0.76, 1.0, r));
    float pupil = 1.0 - smoothstep(pr - 0.025, pr + 0.025, r);
    float irisMask = (1.0 - smoothstep(0.97, 1.04, r)) * front;

    vec3 scl = uSclera * (0.55 + 0.45 * smoothstep(-0.2, 0.9, d.z));
    float vein = smoothstep(0.55, 0.9, snoise(d * 11.0 + uSeed)) * (1.0 - smoothstep(0.2, 0.8, d.z));
    scl = mix(scl, cMakeup * 0.6, vein * 0.25);
    vec3 col = mix(scl, mix(iris, vec3(0.0), pupil), irisMask);

    float kd = max(dot(N, uKeyDir), 0.0);
    col *= 0.35 + 0.6 * kd;
    // el iris brilla (emisivo) — en las referencias los ojos se encienden
    col += iris * uEyeGlow * 0.45 * irisMask * (1.0 - pupil) * (0.55 + 0.7 * fib) * (0.85 + 0.3 * uPulse) * smoothstep(1.0, 0.55, r);
    // sombra del párpado superior
    col *= mix(1.0, 0.35, smoothstep(0.05, 0.55, N.y));
    // córnea húmeda: especular + reflejo de ventana
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uKeyDir), 0.0), 140.0) * 3.5;
    float catchL = smoothstep(0.986, 0.996, dot(R, normalize(uKeyDir + vec3(0.15, 0.3, 0.0))));
    col += vec3(1.0) * (spec + catchL * 2.4);
    col += cRim * pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.35;
    gl_FragColor = vec4(col * uFade, 1.0);
  }
`;

export function eyeMaterial(U, F, seed = 0) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...U, uFade: F.uFade,
      uIris1: { value: new THREE.Color('#ffb020') }, uIris2: { value: new THREE.Color('#ffe080') }, uSclera: { value: new THREE.Color('#d8d0e8') },
      uIrisSize: { value: 0.56 }, uPupil: { value: 0.32 }, uEyeGlow: { value: 1 }, uSeed: { value: seed },
    },
    vertexShader: eyeVert, fragmentShader: eyeFrag,
  });
  m.name = 'ojo';
  return m;
}

// ---------------------------------------------------------------- pelo
const hairVert = /* glsl */ `
  ${simplexNoise3D}
  attribute vec3 aTan;
  attribute vec2 strand;
  uniform mat3 uNeckInv; uniform vec3 uPivot, uShift;
  uniform float uTime, uSway, uFloat, uPulse;
  varying vec3 vT, vN, vPosW; varying vec2 vUv; varying float vRand;
  void main() {
    vec3 p = position;
    float t = uv.y, k = t * t * min(1.0, strand.y * 0.6);
    float ph = uTime * 1.2 + strand.x * 6.2831;
    vec3 off = vec3(sin(ph + p.y * 1.3), 0.0, 0.6 * cos(ph * 0.8 + p.y)) * 0.06 * uSway * k;
    off += vec3(0.0, 0.0, -0.05) * uPulse * k * uSway;
    if (uFloat > 0.001) {
      vec3 q = p * 0.7 + vec3(0.0, uTime * 0.25, strand.x * 2.0);
      off += (vec3(snoise(q), snoise(q + 17.0), snoise(q + 31.0)) * 0.7 + vec3(0.0, 0.55, -0.2)) * uFloat * k * 0.7;
    }
    p += off;
    float w = smoothstep(-1.0, -1.8, position.y);
    p = mix(p, uPivot + uNeckInv * (p - uPivot - uShift), w);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vPosW = wp.xyz;
    mat3 R = mat3(modelMatrix);
    vT = normalize(R * mix(aTan, uNeckInv * aTan, w));
    vN = normalize(R * mix(normal, uNeckInv * normal, w));
    vUv = uv; vRand = strand.x;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const hairFrag = /* glsl */ `
  ${common}
  varying vec3 vT, vN, vPosW; varying vec2 vUv; varying float vRand;
  void main() {
    vec3 T = normalize(vT), N = normalize(vN), V = normalize(cameraPosition - vPosW);
    float kd = smoothstep(-0.2, 0.9, dot(N, uKeyDir));
    vec3 H1 = normalize(uKeyDir + V);
    float th1 = dot(normalize(T + N * 0.18), H1);
    float s1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 110.0);
    vec3 H2 = normalize(uFillDir + V);
    float th2 = dot(normalize(T - N * 0.12), H2);
    float s2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 45.0);
    float fine = 0.5 + 0.5 * sin(vUv.x * 18.0 + vRand * 40.0) * sin(vUv.x * 7.0 + vRand * 13.0);
    float streak = smoothstep(0.35, 0.9, vRand);
    vec3 col = cShadow * 0.04 * (0.5 + vRand) + cSkin * 0.015 * kd;
    s1 = pow(s1, 2.5);
    col += cHair * s1 * 0.9 * (0.2 + kd) * (0.25 + 0.9 * streak) * fine;
    col += mix(cHair, cKey, 0.3) * pow(s2, 2.0) * 0.25 * smoothstep(-0.3, 0.5, dot(N, uFillDir)) * fine * streak;
    float rim = pow(1.0 - abs(dot(N, V)), 4.0);
    col += mix(cHair, cRim, 0.5) * rim * 0.12 * uRimAmt;
    col *= mix(0.4, 1.0, smoothstep(0.0, 0.12, vUv.y));
    gl_FragColor = vec4(col * uFade, 1.0);
  }
`;

export function hairMaterial(U, F) {
  const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...F }, vertexShader: hairVert, fragmentShader: hairFrag, side: THREE.DoubleSide });
  m.name = 'pelo';
  return m;
}

// ---------------------------------------------------------------- pestañas / delineado
const lashVert = /* glsl */ `
  varying vec3 vPosW, vNrmW;
  void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vPosW = wp.xyz; vNrmW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const lashFrag = /* glsl */ `
  ${common}
  varying vec3 vPosW, vNrmW;
  void main() {
    vec3 N = normalize(vNrmW), V = normalize(cameraPosition - vPosW);
    float rim = pow(1.0 - abs(dot(N, V)), 2.0);
    vec3 col = cShadow * 0.06 + cRim * rim * 0.25 + cHair * 0.04;
    gl_FragColor = vec4(col * uFade, 1.0);
  }
`;
export function lashMaterial(U, F) {
  const m = new THREE.ShaderMaterial({ uniforms: { ...U, uFade: F.uFade }, vertexShader: lashVert, fragmentShader: lashFrag, side: THREE.DoubleSide });
  m.name = 'pestañas';
  return m;
}

// ---------------------------------------------------------------- joyas (PBR con env map de la paleta)
export function goldMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffb030, metalness: 1, roughness: 0.22, envMapIntensity: 1.6 });
  m.name = 'oro';
  return m;
}
export function gemMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xff3050, metalness: 0.15, roughness: 0.06, flatShading: true,
    iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [200, 900],
    emissive: 0xff3050, emissiveIntensity: 0.6, envMapIntensity: 2.2, clearcoat: 1,
  });
  m.name = 'gema';
  return m;
}
