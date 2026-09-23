/**
 * Shaders estilo Shadertoy para el mural. Convención CineShader:
 * rgb = color, alpha = altura del relieve (0..1); la AO se calcula sola.
 */
export const PRESETS = {
  ripple: `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord / iResolution.xy;

    // Calculate the to center distance
    float d = length(uv - 0.5) * 2.0;

    // Calculate the ripple time
    float t = d * d * 25.0 - iTime * 3.0;

    // Calculate the ripple thickness
    d = (cos(t) * 0.5 + 0.5) * (1.0 - d);

    // Time varying pixel color
    vec3 col = 0.5 + 0.5 * cos(t / 20.0 + uv.xyx + vec3(0.0,2.0,4.0));

    // Set the output color to rgb channels and the thickness to alpha channel
    // AO is automatically calculated
    fragColor = vec4(col, d);
}`,

  turbulence: `// Turbulence noise: fbm con distorsión de dominio, relieve blanco
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) { v += a * abs(noise(p) * 2.0 - 1.0); p = m * p * 2.0; a *= 0.5; }
    return v;
}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = uv * vec2(iResolution.x / iResolution.y, 1.0) * 3.0;
    float t = iTime * 0.15;
    vec2 q = vec2(fbm(p + t), fbm(p - t * 0.7));
    float h = fbm(p + 2.0 * q);
    h = pow(clamp(h, 0.0, 1.0), 1.4);
    vec3 col = vec3(0.92, 0.96, 1.0) * (0.55 + 0.45 * h);
    fragColor = vec4(col, h);
}`,

  domain: `// Domain distortion (a la Inigo Quilez): ondas suaves blancas
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.0; a *= 0.5; }
    return v;
}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = uv * vec2(iResolution.x / iResolution.y, 1.0) * 4.0;
    float t = iTime * 0.1;
    vec2 q = vec2(fbm(p + vec2(0.0, 0.0) + t), fbm(p + vec2(5.2, 1.3) - t));
    vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2)), fbm(p + 4.0 * q + vec2(8.3, 2.8)));
    float h = fbm(p + 4.0 * r);
    h = smoothstep(0.2, 0.8, h);
    vec3 col = mix(vec3(0.75, 0.82, 0.9), vec3(1.0), h);
    fragColor = vec4(col, h);
}`,

  grid: `// Cuadrícula de calibración plana (sin relieve): útil para enfocar el proyector
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 g = abs(fract(uv * vec2(16.0, 9.0)) - 0.5);
    float line = step(0.47, max(g.x, g.y));
    float cross = step(abs(uv.x - 0.5), 0.002) + step(abs(uv.y - 0.5), 0.003);
    vec3 col = mix(vec3(0.08), vec3(1.0), clamp(line + cross, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.3, 0.6), step(0.98, uv.x) + step(uv.x, 0.02) + step(0.98, uv.y) + step(uv.y, 0.02));
    fragColor = vec4(col, 0.0);
}`,
};

export const PRESET_NAMES = Object.keys(PRESETS);
