import { noiseChunk, runeChunk, moonChunk } from "./common.glsl.js";

// Stone arch around the door: extruded shape, voussoir joints, rune bands on
// the pillars and arch, and a faint ithildin outline revealed by moonlight.

export const frameVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vPos = position;
    vN = normal;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const frameFragment = /* glsl */ `
  ${noiseChunk}
  ${runeChunk}
  ${moonChunk}
  varying vec3 vPos;
  varying vec3 vN;
  varying vec3 vWorld;

  const float R0 = 1.15;
  const float R1 = 1.75;
  const float RM = 1.45;

  void main() {
    vec2 p = vPos.xy;
    float front = smoothstep(0.4, 0.9, vN.z);

    float n = fbm(p * 2.4 + vPos.z * 3.0);
    float grain = fbm(p * 11.0);
    vec3 stone = mix(vec3(0.035, 0.04, 0.038), vec3(0.15, 0.16, 0.145), n * 0.85 + grain * 0.25);
    float moss = smoothstep(0.52, 0.8, fbm(p * 3.1 + 7.0));
    stone = mix(stone, vec3(0.04, 0.11, 0.055), moss * 0.75);

    float joint = 1.0;
    float rune = 0.0;
    float key = 0.0;
    float id = 0.0;

    if (p.y > 0.0) {
      float r = length(p);
      float a = atan(p.y, p.x);
      float N = 11.0;
      float t = a / PI * N;
      float ci = floor(t);
      float fr = fract(t);
      joint = smoothstep(0.0, 0.035, fr) * smoothstep(1.0, 0.965, fr);
      id = ci + 3.0;
      vec2 q = vec2((fr - 0.5) * (PI * RM / N), r - RM) / 0.13;
      if (abs(ci - 5.0) < 0.5) {
        vec2 kq = abs(q);
        float dia = abs(kq.x + kq.y - 1.0);
        key = smoothstep(0.16, 0.04, dia) + smoothstep(0.35, 0.0, length(q)) * 0.8;
      } else {
        rune = runeGlow(q, id, 0.16);
      }
    } else {
      float bh = 0.52;
      float fr = fract(p.y / bh);
      float bi = floor(p.y / bh);
      joint = smoothstep(0.0, 0.04, fr) * smoothstep(1.0, 0.96, fr);
      id = bi * 13.0 + sign(p.x) * 5.0 + 40.0;
      vec2 q = vec2(abs(p.x) - RM, (fr - 0.5) * bh) / 0.13;
      rune = runeGlow(q, id, 0.16);
    }

    stone *= mix(0.45, 1.0, joint);

    // Engraved ithildin outline tracing the inner and outer edge.
    float inner = p.y > 0.0 ? abs(length(p) - (R0 + 0.07)) : abs(abs(p.x) - (R0 + 0.07));
    float outer = p.y > 0.0 ? abs(length(p) - (R1 - 0.07)) : abs(abs(p.x) - (R1 - 0.07));
    float lines = smoothstep(0.018, 0.004, min(inner, outer));

    float reveal = 0.1 + 1.1 * moonReveal(vWorld.xy) + uOpen * 0.6;
    float pulse = 0.85 + 0.15 * sin(uTime * 1.4 + id * 1.7);

    // Door light spilling onto the stone.
    float spill = exp(-length(vWorld.xy - vec2(vWorld.x - p.x, -1.0)) * 0.8) * (0.25 + uOpen * 1.6);
    vec3 lit = stone * (0.55 + 0.45 * front) + EMERALD * spill * 0.06;

    vec3 glow = EMERALD * (rune * 2.8 + lines * 0.7) * reveal * pulse
              + GOLD * key * 2.4 * (0.5 + reveal * 0.6);
    vec3 col = lit + glow * front;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;
