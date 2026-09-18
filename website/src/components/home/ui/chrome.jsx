"use client";

import { HomeLocaleSelect, useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

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
  { href: "#providers", label: "Providers" },
  { href: "#savers", label: "Token savers" },
  { href: "#features", label: "Features" },
  { href: "#quick-start", label: "Quick start" },
  { href: "#demo", label: "Demo" },
];

function MenuIcon({ open }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {open ? (
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      ) : (
        <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function Nav() {
  const { t } = useHomeLocale();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const menuBtnRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1099px)");
    const apply = () => {
      setCompact(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const closeMenu = () => {
    if (menuOpen) menuBtnRef.current?.focus();
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
    };
    const onPointer = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target) || menuBtnRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);

  const links = NAV_LINKS.map((link) => (
    <li key={link.href}>
      <a href={link.href} onClick={closeMenu}>{t(link.label)}</a>
    </li>
  ));

  return (
    <header className={`site-nav ${scrolled ? "is-scrolled" : ""} ${menuOpen ? "is-menu-open" : ""}`}>
      <a className="skip-link" href="#main">{t("Skip to content")}</a>
      <nav className="nav-inner" aria-label={t("Primary")}>
        <a href="#top" className="nav-brand" aria-label={t("DurinDoor home")}>
          <BrandMark />
          <span>DurinDoor</span>
        </a>
        <div
          ref={panelRef}
          id="home-nav-panel"
          className={`nav-panel ${menuOpen ? "is-open" : ""}`}
          aria-hidden={compact && !menuOpen}
          inert={compact && !menuOpen ? true : undefined}
        >
          <ul className="nav-links">{links}</ul>
          <div className="nav-panel-cta">
            <Link className="btn btn-small btn-ghost" href="/docs" onClick={closeMenu}>{t("Docs")}</Link>
            <Link className="btn btn-small btn-primary" href="/dashboard" onClick={closeMenu}>{t("Live demo")}</Link>
          </div>
        </div>
        <div className="nav-actions">
          <HomeLocaleSelect />
          <Link className="btn btn-small btn-ghost nav-action-docs" href="/docs">{t("Docs")}</Link>
          <a className="nav-icon" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label={t("DurinDoor on GitHub")}>
            <GitHubMark size={18} />
          </a>
          <Link className="btn btn-small btn-primary nav-action-demo" href="/dashboard">{t("Live demo")}</Link>
          <button
            ref={menuBtnRef}
            type="button"
            className="nav-menu-btn"
            aria-label={t("Primary")}
            aria-expanded={menuOpen}
            aria-controls="home-nav-panel"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MenuIcon open={menuOpen} />
          </button>
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
