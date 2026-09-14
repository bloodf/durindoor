// Shared GLSL chunks for the hero scene: value noise, fbm, rune glyphs and the
// "ithildin" moonlight reveal. Chunks are concatenated into each material.

export const noiseChunk = /* glsl */ `
  #define PI 3.14159265359
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = m * p;
      a *= 0.5;
    }
    return v;
  }
`;

// Procedural runes: each glyph is a hashed subset of twelve strokes inside a
// [-1, 1] box, which reads as angular Cirth-like lettering once it glows.
export const runeChunk = /* glsl */ `
  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  const vec4 SEGS[12] = vec4[12](
    vec4(0.0, -0.8, 0.0, 0.8),
    vec4(0.0, 0.8, 0.5, 0.3),
    vec4(0.0, 0.3, 0.5, -0.2),
    vec4(0.0, 0.8, -0.5, 0.3),
    vec4(0.0, 0.3, -0.5, -0.2),
    vec4(-0.5, -0.8, 0.5, 0.8),
    vec4(0.5, -0.8, -0.5, 0.8),
    vec4(-0.45, -0.8, -0.45, 0.8),
    vec4(0.45, -0.8, 0.45, 0.8),
    vec4(0.0, -0.2, 0.5, -0.8),
    vec4(0.0, -0.2, -0.5, -0.8),
    vec4(-0.5, 0.8, 0.5, 0.8)
  );
  float runeDist(vec2 p, float id) {
    float d = 1e3;
    if (hash12(vec2(id, id * 1.37 + 4.1)) > 0.12) d = sdSeg(p, SEGS[0].xy, SEGS[0].zw);
    for (int i = 1; i < 12; i++) {
      float r = hash12(vec2(id * 3.1 + float(i) * 7.7, float(i) * 1.9));
      if (r > 0.7) d = min(d, sdSeg(p, SEGS[i].xy, SEGS[i].zw));
    }
    return d;
  }
  float runeGlow(vec2 p, float id, float w) {
    float d = runeDist(p, id);
    return smoothstep(w, w * 0.3, d) + exp(-d * 7.0) * 0.28;
  }
`;

// Moonlight reveal: ithildin only shows where the moon (pointer) falls.
export const moonChunk = /* glsl */ `
  uniform vec2 uMoon;
  uniform float uTime;
  uniform float uOpen;
  float moonReveal(vec2 wp) {
    float d = distance(wp, uMoon);
    return exp(-d * d * 0.45);
  }
  const vec3 EMERALD = vec3(0.07, 0.95, 0.52);
  const vec3 GOLD = vec3(1.0, 0.74, 0.26);
`;

// Door opening geometry shared by the leaves and the light behind them.
export const archChunk = /* glsl */ `
  const float DOOR_R = 1.15;
  const float DOOR_BOTTOM = -2.6;
  // Positive inside the opening, negative outside (in scene units).
  float archInside(vec2 d) {
    return d.y <= 0.0 ? DOOR_R - abs(d.x) : DOOR_R - length(d);
  }
`;

export const basicVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
