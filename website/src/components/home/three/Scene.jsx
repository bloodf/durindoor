"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Vector2, Vector3 } from "three";
import Portal from "./Portal.jsx";
import Beams, { Wall } from "./Beams.jsx";
import Mist from "./Mist.jsx";
import Particles from "./Particles.jsx";

const STATIC_TIME = 14.0;
const lerp = (a, b, t) => a + (b - a) * t;

// Pointer + scroll input kept outside React so the render loop never re-renders.
function useHeroInput(heroId) {
  const input = useRef({ x: 0, y: 0, hasPointer: false, open: 0 });

  useEffect(() => {
    const onMove = (event) => {
      input.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      input.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
      input.current.hasPointer = event.pointerType === "mouse";
    };
    const onScroll = () => {
      const hero = document.getElementById(heroId);
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      input.current.open = Math.min(1, Math.max(0, -rect.top / travel));
    };
    onScroll();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, [heroId]);

  return input;
}

function Rig({ uniforms, heroId, still }) {
  const door = useRef(null);
  const input = useHeroInput(heroId);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const scratch = useMemo(() => ({ dir: new Vector3(), moon: new Vector2() }), []);

  useFrame((state, delta) => {
    const aspect = size.width / size.height;
    const dt = Math.min(delta, 0.05);
    const k = still ? 1 : 1 - Math.exp(-dt * 4);
    const src = input.current;

    uniforms.uTime.value = still ? STATIC_TIME : uniforms.uTime.value + dt;
    uniforms.uOpen.value = still ? 0.12 : lerp(uniforms.uOpen.value, src.open, k);
    const open = uniforms.uOpen.value;

    // Desktop: door sits right of the headline, drifts to center as it opens.
    const offset = aspect > 1.15 ? Math.min(3.4, (aspect - 1) * 6) : 0;
    const doorX = offset * (1 - Math.min(1, open * 1.6));
    const portrait = aspect < 1;
    const baseZ = portrait ? 6.4 / Math.max(aspect, 0.45) : 10.2;
    const baseY = portrait ? -1.2 : -0.35;
    // Portrait: aim below the door so it sits in the top half above the copy.
    const lookY = portrait ? -3.0 * (1 - open) - 0.7 * open : -0.7;
    const px = still ? 0 : src.x;
    const py = still ? 0 : src.y;

    if (door.current) door.current.position.x = doorX;
    uniforms.uDoor.value.set(doorX, -1);

    camera.position.x = lerp(camera.position.x, px * 0.45, k * 0.6);
    camera.position.y = lerp(camera.position.y, baseY + py * 0.25 - open * 0.5, k * 0.6);
    camera.position.z = lerp(camera.position.z, baseZ - Math.pow(open, 1.6) * 7.6, k);
    camera.lookAt(doorX * 0.35, lookY, 0);

    // Moon follows the mouse; on touch or idle it orbits the door slowly.
    if (src.hasPointer && !still) {
      scratch.dir.set(src.x, src.y, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position.z / scratch.dir.z;
      scratch.moon.set(camera.position.x + scratch.dir.x * t, camera.position.y + scratch.dir.y * t);
    } else {
      const time = uniforms.uTime.value;
      scratch.moon.set(doorX + Math.sin(time * 0.35) * 1.6, -0.6 + Math.cos(time * 0.23) * 1.4);
    }
    uniforms.uMoon.value.lerp(scratch.moon, k);
  });

  return (
    <group ref={door}>
      <Wall uniforms={uniforms} />
      <Portal uniforms={uniforms} />
      <Beams uniforms={uniforms} />
      <Mist uniforms={uniforms} />
    </group>
  );
}

// Pause rendering whenever the hero is scrolled out of view.
function useHeroVisible(heroId) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const hero = document.getElementById(heroId);
    if (!hero) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroId]);
  return visible;
}

export default function Scene({ heroId, still = false, onReady }) {
  const visible = useHeroVisible(heroId);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uMoon: { value: new Vector2(1.5, 0.5) },
      uDoor: { value: new Vector2(0, -1) },
    }),
    [],
  );
  const small = typeof window !== "undefined" && window.innerWidth < 720;

  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={still ? "demand" : visible ? "always" : "never"}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: 40, position: [0, -0.3, 8.2], near: 0.1, far: 60 }}
      onCreated={() => onReady?.()}
      aria-hidden="true"
    >
      <color attach="background" args={["#040705"]} />
      <Rig uniforms={uniforms} heroId={heroId} still={still} />
      <Particles uniforms={uniforms} count={small ? 180 : 420} />
      <EffectComposer multisampling={0} disableNormalPass>
        <Bloom mipmapBlur luminanceThreshold={0.42} luminanceSmoothing={0.3} intensity={1.15} radius={0.72} />
        <Vignette offset={0.28} darkness={0.78} />
      </EffectComposer>
    </Canvas>
  );
}
