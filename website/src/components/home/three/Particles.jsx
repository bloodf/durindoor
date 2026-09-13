"use client";

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { AdditiveBlending } from "three";
import { particleVertex, particleFragment } from "@site/shaders/atmosphere.glsl.js";

// Dust motes and fireflies drifting up through the door light.
function seeded(count) {
  let s = 1337;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rand() - 0.5) * 12;
    positions[i * 3 + 1] = rand() * 8 - 3.5;
    positions[i * 3 + 2] = rand() * 4 - 0.8;
    seeds[i] = rand();
  }
  return { positions, seeds };
}

export default function Particles({ uniforms, count = 420 }) {
  const dpr = useThree((state) => state.viewport.dpr);
  const { positions, seeds } = useMemo(() => seeded(count), [count]);
  const pointUniforms = useMemo(
    () => ({ uTime: uniforms.uTime, uPixelRatio: { value: dpr }, uSize: { value: 8 } }),
    [uniforms, dpr],
  );

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={particleVertex}
        fragmentShader={particleFragment}
        uniforms={pointUniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
