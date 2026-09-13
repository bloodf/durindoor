"use client";

import { useMemo } from "react";
import { basicVertex } from "@site/shaders/common.glsl.js";
import { mistFragment } from "@site/shaders/atmosphere.glsl.js";

// Layered fbm sheets rolling along the threshold at different depths/speeds.
const LAYERS = [
  { z: -0.1, y: -2.3, w: 14, h: 2.6, density: 0.8, speed: 0.03, seed: 1 },
  { z: 0.9, y: -2.5, w: 16, h: 2.4, density: 0.7, speed: -0.022, seed: 4 },
  { z: 2.2, y: -2.8, w: 18, h: 2.2, density: 0.55, speed: 0.04, seed: 9 },
];

function MistLayer({ layer, uniforms }) {
  const layerUniforms = useMemo(
    () => ({
      ...uniforms,
      uDensity: { value: layer.density },
      uSpeed: { value: layer.speed },
      uSeed: { value: layer.seed },
    }),
    [uniforms, layer],
  );

  return (
    <mesh position={[0, layer.y, layer.z]}>
      <planeGeometry args={[layer.w, layer.h]} />
      <shaderMaterial
        vertexShader={basicVertex}
        fragmentShader={mistFragment}
        uniforms={layerUniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

export default function Mist({ uniforms }) {
  return (
    <group>
      {LAYERS.map((layer) => (
        <MistLayer key={layer.seed} layer={layer} uniforms={uniforms} />
      ))}
    </group>
  );
}
