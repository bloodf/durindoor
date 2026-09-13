"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ReactLenis } from "lenis/react";
import { MotionConfig, motion, useScroll, useSpring, useReducedMotion } from "motion/react";
import { GitHubMark } from "./Icon.jsx";
import { GITHUB_URL } from "../data.js";


export function SmoothScroll({ children }) {
  const reduce = useReducedMotion();
  const content = <MotionConfig reducedMotion="user">{children}</MotionConfig>;
  if (reduce) return content;
  return (
    <ReactLenis root options={{ lerp: 0.11, anchors: { offset: -72 }, autoRaf: true }}>
      {content}
    </ReactLenis>
  );
}

// Soft emerald light that trails the mouse. Pointer devices only.
export function CursorGlow() {
  const ref = useRef(null);
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce || !ref.current) return undefined;
    const node = ref.current;
    let frame = 0;
    const onMove = (event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
        node.style.opacity = "1";
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden="true" />;
}

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#quick-start", label: "Quick start" },
  { href: "#demo", label: "Demo" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-nav ${scrolled ? "is-scrolled" : ""}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="nav-inner" aria-label="Primary">
        <a href="#top" className="nav-brand" aria-label="DurinDoor home">
          <BrandMark />
          <span>DurinDoor</span>
        </a>
        <ul className="nav-links">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <div className="nav-actions">
          <a className="nav-icon" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="DurinDoor on GitHub">
            <GitHubMark size={20} />
          </a>
          <Link className="btn btn-small btn-primary" href="/dashboard">
            Live demo
          </Link>
        </div>
      </nav>
    </header>
  );
}

// Tiny arch glyph used in the nav and footer.
export function BrandMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 29V14a10 10 0 0 1 20 0v15" stroke="#D4AF37" strokeWidth="2.2" />
      <path d="M10.5 29V14.5a5.5 5.5 0 0 1 11 0V29" stroke="#10E882" strokeWidth="1.6" opacity="0.9" />
      <path d="M16 11v18" stroke="#10E882" strokeWidth="1.6" />
      <circle cx="16" cy="19" r="1.8" fill="#10E882" />
    </svg>
  );
}
