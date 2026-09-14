"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import "@designcodeio/threeui/style.css";

// ThreeUI community components (MIT, @designcodeio/threeui). Only the ones that
// render their own canvas are used here; the iframe-based "Neuform" effects load
// third-party CDNs and are deliberately avoided. Each one is code-split and only
// fetched once its stage nears the viewport. The components pause their own
// render loop when scrolled out of view or when the tab is hidden.
const EFFECTS = {
  stream: dynamic(
    () => import("@designcodeio/threeui/components/StreamConvergenceBackground").then((m) => m.StreamConvergenceBackground),
    { ssr: false },
  ),
  laser: dynamic(() => import("@designcodeio/threeui/components/LaserCollection").then((m) => m.LaserCollection), {
    ssr: false,
  }),
  horizon: dynamic(
    () => import("@designcodeio/threeui/components/EmeraldHorizonBackground").then((m) => m.EmeraldHorizonBackground),
    { ssr: false },
  ),
  bell: dynamic(() => import("@designcodeio/threeui/components/BellFieldBackground").then((m) => m.BellFieldBackground), {
    ssr: false,
  }),
};

function canRender() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// Decorative WebGL backdrop. The CSS fallback (`.three-stage-fallback`, tinted
// per `effect`) is always painted underneath, so there is no layout shift and
// reduced-motion or no-WebGL visitors still get a themed surface.
export default function ThreeStage({ effect, className = "", ...props }) {
  const ref = useRef(null);
  const [live, setLive] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !canRender()) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setLive(true);
        observer.disconnect();
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!live) return undefined;
    // Fade the canvas in after its first frames so the swap is invisible.
    const timer = setTimeout(() => setShown(true), 260);
    return () => clearTimeout(timer);
  }, [live]);

  const Effect = EFFECTS[effect];
  return (
    <div ref={ref} className={`three-stage is-${effect} ${shown ? "is-shown" : ""} ${className}`} aria-hidden="true">
      <div className="three-stage-fallback" />
      {live && Effect ? (
        <div className="three-stage-canvas">
          <Effect {...props} />
        </div>
      ) : null}
    </div>
  );
}
