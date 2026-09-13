"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import Icon from "./Icon.jsx";

const MotionLink = motion.create(Link);

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

export function CopyButton({ text, label = "Copy", className = "" }) {
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
    <button type="button" className={`copy-btn ${className}`} onClick={copy} aria-label={copied ? "Copied" : `${label} to clipboard`}>
      <Icon name={copied ? "check" : "copy"} size={16} />
      <span className="copy-btn-text" aria-live="polite">{copied ? "Copied" : label}</span>
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
