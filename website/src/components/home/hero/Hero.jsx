"use client";

import { motion, useScroll, useTransform } from "motion/react";
import HeroCanvas from "./HeroCanvas.jsx";
import { CopyButton, Magnetic } from "../ui/primitives.jsx";
import Icon, { GitHubMark } from "../ui/Icon.jsx";
import { GITHUB_URL } from "../data.js";

const HERO_ID = "top";
const INSTALL = "npm install -g durindoor";
const WORDS = ["Speak,", "friend,", "and"];

const rise = (i) => ({
  initial: { opacity: 0, y: 28, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.9, delay: 0.15 + i * 0.12, ease: [0.22, 1, 0.36, 1] },
});

export default function Hero() {
  // Function transforms keep these on the JS path; the accelerated scroll
  // timeline path mis-tracked the sticky hero.
  const { scrollY } = useScroll();
  const vh = () => (typeof window === "undefined" ? 900 : window.innerHeight);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const contentOpacity = useTransform(scrollY, (y) => 1 - clamp(y / (vh() * 0.4)));
  const contentY = useTransform(scrollY, (y) => -80 * clamp(y / (vh() * 0.4)));
  const cueOpacity = useTransform(scrollY, (y) => 1 - clamp(y / (vh() * 0.1)));
  const flash = useTransform(scrollY, (y) => {
    const t = y / vh();
    return t < 0.55 ? 0 : t < 0.85 ? ((t - 0.55) / 0.3) * 0.6 : Math.max(0, 0.6 - ((t - 0.85) / 0.25) * 0.6);
  });

  return (
    <section id={HERO_ID} className="hero" aria-labelledby="hero-title">
      <div className="hero-sticky">
        <HeroCanvas heroId={HERO_ID} />
        <div className="hero-shade" aria-hidden="true" />

        <motion.div className="hero-content container" style={{ opacity: contentOpacity, y: contentY }}>
          <motion.p className="hero-kicker" {...rise(0)}>
            <span className="kicker-dot" aria-hidden="true" />
            Open source · MIT · Self-hosted AI gateway
          </motion.p>

          <h1 id="hero-title" className="hero-title">
            {WORDS.map((word, i) => (
              <motion.span key={word} className="hero-word" {...rise(i + 1)}>
                {word}{" "}
              </motion.span>
            ))}
            <motion.span className="hero-word ithildin" {...rise(4)}>
              enter.
            </motion.span>
          </h1>

          <motion.p className="hero-sub" {...rise(5)}>
            One guarded gateway for every AI provider. Add credentials once, point every
            OpenAI-compatible tool at a single local endpoint.
          </motion.p>

          <motion.div className="hero-ctas" {...rise(6)}>
            <Magnetic internal href="/dashboard" className="btn btn-primary btn-large">
              Open the live demo
              <Icon name="arrow" size={18} />
            </Magnetic>
            <div className="install-pill" role="group" aria-label="Install command">
              <span className="install-prompt" aria-hidden="true">$</span>
              <code>{INSTALL}</code>
              <CopyButton text={INSTALL} label="Install" />
            </div>
          </motion.div>

          <motion.a className="hero-github" href={GITHUB_URL} target="_blank" rel="noreferrer" {...rise(7)}>
            <GitHubMark size={16} />
            Star bloodf/durindoor on GitHub
          </motion.a>
        </motion.div>

        <motion.div className="hero-flash" style={{ opacity: flash }} aria-hidden="true" />
        <motion.div className="scroll-cue" style={{ opacity: cueOpacity }} aria-hidden="true">
          <span>Scroll to open the door</span>
          <span className="scroll-cue-line" />
        </motion.div>
      </div>
    </section>
  );
}
