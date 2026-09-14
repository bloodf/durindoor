import { noiseChunk, moonChunk } from "./common.glsl.js";

// Cliff wall, god-ray beams, mist and fireflies.

export const wallFragment = /* glsl */ `
  ${noiseChunk}
  ${moonChunk}
  uniform vec2 uDoor;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec2 p = vWorld.xy;
    float cliff = fbm(vec2(p.x * 1.1, p.y * 0.22) + 2.0);
    float rock = fbm(p * 0.9 + cliff * 1.5);
    float crack = smoothstep(0.03, 0.0, abs(fbm(p * 0.7 + 9.0) - 0.5));
    vec3 col = mix(vec3(0.004, 0.007, 0.005), vec3(0.06, 0.075, 0.066), pow(rock * 0.9 + cliff * 0.3, 1.6));
    col *= 1.0 - crack * 0.18;
    float moss = smoothstep(0.55, 0.85, fbm(p * 1.4 + 5.0));
    col = mix(col, vec3(0.02, 0.07, 0.035), moss * 0.6);

    float dd = length((p - uDoor) * vec2(0.75, 1.0));
    float glow = exp(-dd * 0.55) * (0.18 + uOpen * 0.9);
    float moon = moonReveal(p) * 0.08;
    col += EMERALD * glow * 0.22 * (0.6 + rock);
    col += vec3(0.55, 0.7, 0.65) * moon * rock;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export const beamFragment = /* glsl */ `
  ${noiseChunk}
  ${moonChunk}
  uniform float uIntensity;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float along = smoothstep(0.0, 0.08, vUv.y) * pow(1.0 - vUv.y, 1.6);
    float flicker = 0.55 + 0.45 * vnoise(vec2(vUv.x * 3.0 + uSeed, vUv.y * 2.5 - uTime * 0.35));
    float a = pow(across, 3.0) * along * flicker * uIntensity;
    vec3 col = mix(EMERALD, GOLD, uSeed * 0.12) * a;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export const mistFragment = /* glsl */ `
  ${noiseChunk}
  ${moonChunk}
  uniform vec2 uDoor;
  uniform float uDensity;
  uniform float uSpeed;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec2 q = vUv * vec2(4.0, 1.4) + vec2(uTime * uSpeed + uSeed, uSeed * 0.3);
    float n = fbm(q + fbm(q * 1.7 - uTime * 0.05) * 0.8);
    float edges = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x)
                * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    float a = smoothstep(0.28, 0.8, n) * edges * uDensity;
    float nearDoor = exp(-abs(vWorld.x - uDoor.x) * 0.5);
    vec3 col = mix(vec3(0.22, 0.27, 0.25), EMERALD * 0.6, nearDoor * (0.35 + uOpen * 0.8));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export const particleVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  attribute float aSeed;
  varying float vSeed;
  varying float vTwinkle;
  void main() {
    vec3 p = position;
    float speed = 0.08 + aSeed * 0.22;
    p.y = mod(p.y + uTime * speed + 3.5, 8.0) - 3.5;
    p.x += sin(uTime * 0.4 + aSeed * 40.0) * 0.25;
    p.z += cos(uTime * 0.3 + aSeed * 23.0) * 0.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vTwinkle = 0.45 + 0.55 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 90.0);
    gl_PointSize = uSize * (0.4 + aSeed) * uPixelRatio * (6.0 / -mv.z);
    vSeed = aSeed;
  }
`;

export const particleFragment = /* glsl */ `
  varying float vSeed;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a * vTwinkle;
    vec3 col = mix(vec3(0.2, 1.0, 0.6), vec3(1.0, 0.8, 0.35), step(0.78, vSeed));
    gl_FragColor = vec4(col * a * 1.8, a);
    #include <colorspace_fragment>
  }
`;
