"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide } from "three";
import { basicVertex } from "@site/shaders/common.glsl.js";
import { beamFragment, wallFragment } from "@site/shaders/atmosphere.glsl.js";

// God rays fanning out of the door plus the vertical shaft of light, and the
// cliff wall the door is carved into.
const BEAMS = [
  { angle: 0, width: 0.22, height: 10, seed: 0, y: -2.6, gain: 1.3 },
  { angle: 0.22, width: 1.1, height: 8, seed: 3, y: -1.2, gain: 0.5 },
  { angle: -0.26, width: 1.3, height: 8.5, seed: 5, y: -1.2, gain: 0.45 },
  { angle: 0.55, width: 0.9, height: 6, seed: 7, y: -1.4, gain: 0.3 },
  { angle: -0.6, width: 0.8, height: 6.5, seed: 8, y: -1.4, gain: 0.3 },
];

function Beam({ beam, uniforms }) {
  const beamUniforms = useMemo(
    () => ({ ...uniforms, uIntensity: { value: 0 }, uSeed: { value: beam.seed } }),
    [uniforms, beam.seed],
  );

  useFrame(() => {
    const open = uniforms.uOpen.value;
    beamUniforms.uIntensity.value = beam.gain * (0.35 + open * 1.9);
  });

  return (
    <group position={[0, beam.y, 0.05]} rotation={[0, 0, beam.angle]}>
      <mesh position={[0, beam.height / 2, 0]}>
      <planeGeometry args={[beam.width, beam.height]} />
      <shaderMaterial
        vertexShader={basicVertex}
        fragmentShader={beamFragment}
        uniforms={beamUniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        side={DoubleSide}
      />
      </mesh>
    </group>
  );
}

// Wall glow follows the shared uDoor uniform, which tracks the door offset.
export function Wall({ uniforms }) {
  return (
    <mesh position={[0, 0, -0.45]}>
      <planeGeometry args={[40, 22]} />
      <shaderMaterial vertexShader={basicVertex} fragmentShader={wallFragment} uniforms={uniforms} />
    </mesh>
  );
}

export default function Beams({ uniforms }) {
  return (
    <group>
      {BEAMS.map((beam) => (
        <Beam key={beam.seed} beam={beam} uniforms={uniforms} />
      ))}
    </group>
  );
}
