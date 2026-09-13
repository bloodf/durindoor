"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const Scene = dynamic(() => import("../three/Scene.jsx"), { ssr: false });

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// Mounts the WebGL door after hydration. The CSS fallback underneath is always
// painted, so the hero never shifts and stays meaningful without WebGL.
export default function HeroCanvas({ heroId }) {
  const [mode, setMode] = useState("pending");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasWebGL()) {
      setMode("none");
      return undefined;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMode(query.matches ? "still" : "live");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div className="hero-stage" aria-hidden="true">
      <div className="hero-fallback">
        <div className="hero-fallback-arch" />
        <div className="hero-fallback-seam" />
      </div>
      {mode === "live" || mode === "still" ? (
        <div className={`hero-canvas ${ready ? "is-ready" : ""}`}>
          <Scene key={mode} heroId={heroId} still={mode === "still"} onReady={() => setReady(true)} />
        </div>
      ) : null}
    </div>
  );
}
