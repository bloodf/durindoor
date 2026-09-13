"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, ExtrudeGeometry, Shape } from "three";
import { basicVertex } from "@site/shaders/common.glsl.js";
import { frameVertex, frameFragment } from "@site/shaders/frame.glsl.js";
import { leafVertex, leafFragment, lightFragment } from "@site/shaders/leaf.glsl.js";

const R_IN = 1.15;
const R_OUT = 1.75;
const BOTTOM = -2.6;
const DOOR_HEIGHT = R_IN - BOTTOM;

// Inverted-U outline: up the outer left pillar, over the outer arch, down the
// right pillar, then back along the inner edge. One contour, no holes.
function frameShape() {
  const shape = new Shape();
  shape.moveTo(-R_OUT, BOTTOM);
  shape.lineTo(-R_OUT, 0);
  shape.absarc(0, 0, R_OUT, Math.PI, 0, true);
  shape.lineTo(R_OUT, BOTTOM);
  shape.lineTo(R_IN, BOTTOM);
  shape.lineTo(R_IN, 0);
  shape.absarc(0, 0, R_IN, 0, Math.PI, false);
  shape.lineTo(-R_IN, BOTTOM);
  shape.closePath();
  return shape;
}

function useFrameGeometry() {
  return useMemo(
    () =>
      new ExtrudeGeometry(frameShape(), {
        depth: 0.38,
        curveSegments: 64,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.035,
        bevelSegments: 2,
      }),
    [],
  );
}

function Leaf({ side, uniforms }) {
  const pivot = useRef(null);
  const leafUniforms = useMemo(() => ({ ...uniforms, uSide: { value: side } }), [uniforms, side]);

  useFrame(() => {
    if (!pivot.current) return;
    // Leaves swing toward the viewer as the page scrolls past the hero.
    const eased = 1 - Math.pow(1 - uniforms.uOpen.value, 2.2);
    pivot.current.rotation.y = side * eased * 1.28;
  });

  return (
    <group ref={pivot} position={[side * R_IN, 0, 0]}>
      <mesh position={[-side * R_IN * 0.5, BOTTOM + DOOR_HEIGHT / 2, 0]}>
        <planeGeometry args={[R_IN, DOOR_HEIGHT, 1, 1]} />
        <shaderMaterial
          vertexShader={leafVertex}
          fragmentShader={leafFragment}
          uniforms={leafUniforms}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

export default function Portal({ uniforms }) {
  const frameGeometry = useFrameGeometry();

  return (
    <group>
      <mesh position={[0, BOTTOM + DOOR_HEIGHT / 2, -0.28]}>
        <planeGeometry args={[R_IN * 2, DOOR_HEIGHT]} />
        <shaderMaterial vertexShader={basicVertex} fragmentShader={lightFragment} uniforms={uniforms} />
      </mesh>
      <mesh geometry={frameGeometry} position={[0, 0, -0.26]}>
        <shaderMaterial vertexShader={frameVertex} fragmentShader={frameFragment} uniforms={uniforms} />
      </mesh>
      <Leaf side={-1} uniforms={uniforms} />
      <Leaf side={1} uniforms={uniforms} />
    </group>
  );
}
