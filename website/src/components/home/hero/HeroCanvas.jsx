"use client";
import dynamic from "next/dynamic";
import { Component, useEffect, useState } from "react";
const Scene = dynamic(() => import("../three/Scene.jsx"), { ssr: false });
class CanvasBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure?.();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
/** Static artwork remains visible with reduced motion, missing WebGL, or a failed canvas. */
export default function HeroCanvas({ progress, opened, onAvailability }) {
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReady(false);
      try {
        setLive(
          !query.matches &&
            Boolean(document.createElement("canvas").getContext("webgl2")),
        );
      } catch {
        setLive(false);
      }
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    onAvailability?.(live && ready);
  }, [live, ready, onAvailability]);
  return (
    <div className="gateway-stage" data-ready={live && ready} aria-hidden="true">
      <img
        className="gateway-poster"
        src="/brand/durindoor-gateway.webp"
        alt=""
        width="1920"
        height="1080"
      />
      {live ? (
        <CanvasBoundary onFailure={() => { setReady(false); setLive(false); }}>
          <Scene
            progress={progress}
            opened={opened}
            onReady={() => setReady(true)}
            onFailure={() => { setReady(false); setLive(false); }}
          />
        </CanvasBoundary>
      ) : null}
    </div>
  );
}
