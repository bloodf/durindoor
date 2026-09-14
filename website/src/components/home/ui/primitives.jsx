"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import Icon from "./Icon.jsx";

const MotionLink = motion.create(Link);

// Counts from `from` to `to` the first time it scrolls into view. Server markup
// and reduced-motion users get the final value, so the number is never wrong.
export function CountUp({ to, from = 0, duration = 1.6, format, className = "" }) {
  const { locale } = useHomeLocale();
  const number = format ?? ((n) => Math.round(n).toLocaleString(locale));
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(to);

  useEffect(() => {
    if (!inView || reduce) return undefined;
    const controls = animate(from, to, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setValue });
    return () => controls.stop();
  }, [inView, reduce, from, to, duration]);

  useEffect(() => {
    if (!reduce) setValue(from);
    // Only reset once on mount; the animation above takes it from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span ref={ref} className={className}>
      {number(value)}
    </span>
  );
}

// Fade-and-rise on first view. The page-level MotionConfig drops the movement
// for reduced-motion users; only the opacity fade remains.
export function Reveal({ children, delay = 0, y = 24, as = "div", className = "" }) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
}

export function CopyButton({ text, label, className = "" }) {
  const { t } = useHomeLocale();
  const actionLabel = label ?? t("Copy");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className={`copy-btn ${className}`} onClick={copy} aria-label={copied ? t("Copied") : t("{label} to clipboard", { label: actionLabel })}>
      <Icon name={copied ? "check" : "copy"} size={16} />
      <span className="copy-btn-text" aria-live="polite">{copied ? t("Copied") : actionLabel}</span>
    </button>
  );
}

// Pulls toward the cursor a little. Works as a link or button, keeps focus ring.
export function Magnetic({ children, className = "", strength = 0.28, internal = false, ...props }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const Tag = props.href ? (internal ? MotionLink : motion.a) : motion.button;

  const onMove = (event) => {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setOffset({
      x: (event.clientX - rect.left - rect.width / 2) * strength,
      y: (event.clientY - rect.top - rect.height / 2) * strength,
    });
  };

  return (
    <Tag
      ref={ref}
      className={className}
      onPointerMove={onMove}
      onPointerLeave={() => setOffset({ x: 0, y: 0 })}
      animate={offset}
      transition={{ type: "spring", stiffness: 220, damping: 16, mass: 0.4 }}
      {...props}
    >
      {children}
    </Tag>
  );
}

// Tracks pointer position in CSS vars for the spotlight hover on cards.
export function spotlight(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

export function RuneDivider({ className = "" }) {
  return (
    <div className={`rune-divider ${className}`} aria-hidden="true">
      <span className="rune-line" />
      <svg width="120" height="20" viewBox="0 0 120 20" fill="none" stroke="currentColor" strokeWidth="1.3">
        <path d="M8 16V4l6 6M26 4v12M26 8l6-4M26 12l6 4M50 10l10-6 10 6-10 6zM60 7v6M88 4v12l6-6M106 16V4M100 10h12" />
      </svg>
      <span className="rune-line" />
    </div>
  );
}

export function SectionHeader({ eyebrow, title, lead, align = "center" }) {
  return (
    <Reveal className={`section-header is-${align}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="section-title">{title}</h2>
      {lead ? <p className="section-lead">{lead}</p> : null}
    </Reveal>
  );
}
