import { noiseChunk, runeChunk, moonChunk, archChunk } from "./common.glsl.js";

// One door leaf. uSide = -1 for the left leaf, +1 for the right one. The plane
// is mapped back into door coordinates so both leaves share one rune circle.

export const leafVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const leafFragment = /* glsl */ `
  ${noiseChunk}
  ${runeChunk}
  ${moonChunk}
  ${archChunk}
  uniform float uSide;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec2 d = vec2(
      uSide < 0.0 ? mix(-DOOR_R, 0.0, vUv.x) : mix(0.0, DOOR_R, vUv.x),
      mix(DOOR_BOTTOM, DOOR_R, vUv.y)
    );
    float e = archInside(d);
    if (e < 0.0) discard;

    // Carved panels: vertical planks with a darker border groove.
    float planks = fbm(d * vec2(1.4, 7.0) + uSide * 3.0);
    vec3 base = mix(vec3(0.02, 0.024, 0.022), vec3(0.085, 0.095, 0.088), planks);
    base *= 0.8 + 0.2 * fbm(d * 14.0);
    float groove = smoothstep(0.012, 0.0, abs(e - 0.11));
    base *= 1.0 - groove * 0.6;
    float panelEdge = min(abs(abs(d.x) - 0.55), abs(d.y + 2.1));
    base *= 1.0 - smoothstep(0.012, 0.0, panelEdge) * step(d.y, -1.95) * 0.5;

    vec2 c = d - vec2(0.0, -1.2);
    float rr = length(c);
    float ring = smoothstep(0.012, 0.0, abs(rr - 0.56)) + smoothstep(0.012, 0.0, abs(rr - 0.76));

    float runes = 0.0;
    if (rr > 0.56 && rr < 0.76) {
      float a = atan(c.y, c.x);
      float N = 22.0;
      float t = (a + PI) / (2.0 * PI) * N;
      vec2 q = vec2((fract(t) - 0.5) * (2.0 * PI * 0.66 / N), rr - 0.66) / 0.075;
      runes = runeGlow(q, floor(t) + 90.0, 0.17);
    }

    // Seven-pointed star of Durin inside the rune circle.
    float star = 1e3;
    for (int i = 0; i < 7; i++) {
      float a0 = float(i) * 2.0 * PI / 7.0 + PI / 2.0;
      float a1 = a0 + 3.0 * 2.0 * PI / 7.0;
      star = min(star, sdSeg(c, vec2(cos(a0), sin(a0)) * 0.46, vec2(cos(a1), sin(a1)) * 0.46));
    }
    float starGlow = smoothstep(0.01, 0.0, star) + exp(-star * 70.0) * 0.15;

    float reveal = 0.08 + 1.1 * moonReveal(vWorld.xy) + uOpen * 0.7;
    float pulse = 0.85 + 0.15 * sin(uTime * 1.1 + rr * 8.0);

    // The seam of light between the leaves, hottest at the rune circle.
    float s = abs(d.x);
    float seam = exp(-s * 55.0) * (0.9 + uOpen * 2.5) * (0.7 + 0.3 * exp(-abs(d.y + 1.2) * 1.5));

    vec3 col = base;
    col += EMERALD * (runes * 2.2 + ring * 1.2) * reveal * pulse;
    col += GOLD * starGlow * 0.6 * reveal;
    col += EMERALD * groove * 0.35 * reveal;
    col += mix(EMERALD, vec3(0.8, 1.0, 0.9), exp(-s * 140.0)) * seam * 2.2;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export const lightFragment = /* glsl */ `
  ${noiseChunk}
  ${moonChunk}
  ${archChunk}
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec2 d = vec2(mix(-DOOR_R, DOOR_R, vUv.x), mix(DOOR_BOTTOM, DOOR_R, vUv.y));
    if (archInside(d) < 0.0) discard;
    float t = uTime * 0.25;
    vec2 w = d * 1.6;
    float swirl = fbm(w + vec2(fbm(w + t), fbm(w - t + 3.1)) * 1.4);
    float column = exp(-abs(d.x) * 3.2);
    vec3 col = mix(EMERALD * 0.6, GOLD, smoothstep(0.55, 0.9, swirl) * 0.35);
    col = mix(col, vec3(0.85, 1.0, 0.92), column * 0.6);
    float power = (0.35 + uOpen * 2.4) * (0.6 + swirl * 0.8);
    gl_FragColor = vec4(col * power, 1.0);
    #include <colorspace_fragment>
  }
`;
