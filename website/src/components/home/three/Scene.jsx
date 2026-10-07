"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Vector2 } from "three";
import Portal from "./Portal.jsx";
import Beams, { Wall } from "./Beams.jsx";
import Mist from "./Mist.jsx";
import Particles from "./Particles.jsx";
import { gateOpening } from "./gateOpening.js";

function Gateway({ progress, opened, stage }) {
  const { camera, size } = useThree();
  const uniforms = useMemo(() => ({
    uTime: { value: 14 },
    uOpen: { value: 0 },
    uMoon: { value: new Vector2(0.6, 0.5) },
    uDoor: { value: new Vector2(0, -1) },
  }), []);
  const moon = useMemo(() => new Vector2(), []);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const smoothing = 1 - Math.exp(-dt * 3);
    const target = gateOpening(progress?.get() ?? 0, opened);
    uniforms.uTime.value += dt;
    uniforms.uOpen.value += (target - uniforms.uOpen.value) * smoothing;
    const open = uniforms.uOpen.value;
    const aspect = size.width / size.height;
    const distance = Math.max(7.9, 4.7 / aspect);
    camera.position.x += (state.pointer.x * 0.32 - camera.position.x) * smoothing * 0.5;
    camera.position.y += (-0.65 + state.pointer.y * 0.16 - camera.position.y) * smoothing * 0.5;
    camera.position.z += (distance - open * 0.85 - camera.position.z) * smoothing;
    camera.lookAt(0, -0.65, -0.5);
    moon.set(state.pointer.x * 1.3 + 0.6, state.pointer.y + 0.5);
    uniforms.uMoon.value.lerp(moon, smoothing * 0.5);
    // The actual rendered opening is inspectable by browser behavior checks.
    if (stage.current) stage.current.dataset.open = open.toFixed(3);
  });
  return <>
    <ambientLight intensity={0.65} />
    <directionalLight position={[-3, 5, 4]} color="#cadfd4" intensity={2} />
    <Wall uniforms={uniforms} />
    <Portal uniforms={uniforms} />
    <Beams uniforms={uniforms} />
    <Mist uniforms={uniforms} />
    <Particles uniforms={uniforms} count={size.width < 500 ? 100 : 220} />
  </>;
}

/** Perspective stone gateway; rendering pauses outside the hero and in hidden tabs. */
export default function Scene({ progress, opened, onFailure }) {
  const ref = useRef(null);
  const [active, setActive] = useState(true);
  useEffect(() => {
    let visible = true;
    const sync = () => setActive(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(ref.current);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return <div ref={ref} className="gateway-webgl" data-open="0">
    <Canvas
      camera={{ position: [0, -0.65, 8.5], fov: 40, near: 0.1, far: 40 }}
      dpr={[1, 1.5]}
      frameloop={active ? "always" : "never"}
      gl={{ alpha: false, antialias: false, powerPreference: "low-power", stencil: false }}
      onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", onFailure, { once: true })}
    >
      <color attach="background" args={["#0c1410"]} />
      <Gateway progress={progress} opened={opened} stage={ref} />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.65} intensity={0.7} radius={0.6} />
        <Vignette offset={0.35} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  </div>;
}
