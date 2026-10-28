"use client";
import { useEffect, useRef, useState } from 'react';
import { startGateScene } from './gate-scene.js';
import './login.css';

export default function GateScene({ fallback = false, initiallyPaused = false }) {
  const canvas = useRef(null), controller = useRef(null);
  const [mode, setMode] = useState('css');
  const [paused, setPaused] = useState(initiallyPaused);
  useEffect(() => {
    controller.current = startGateScene(canvas.current, { fallback, paused: initiallyPaused, onMode: setMode });
    return () => controller.current?.destroy();
  }, [fallback, initiallyPaused]);
  const toggle = () => { const next = !paused; setPaused(next); controller.current?.setPaused(next); };
  return <div className="v5-gate-scene" data-renderer={mode}>
    <div className="v5-gate-fallback" aria-hidden="true"><div className="v5-gate-arch"><div className="v5-gate-leaf" /></div></div>
    <canvas ref={canvas} aria-hidden="true" className="v5-gate-canvas" />
    {mode === 'webgl' ? <button type="button" className="v5-gate-pause" aria-pressed={paused} onClick={toggle}>{paused ? 'Resume animation' : 'Pause animation'}</button> : null}
  </div>;
}
