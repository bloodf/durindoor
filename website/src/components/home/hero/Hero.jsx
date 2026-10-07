"use client";
import { useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from "motion/react";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import HeroCanvas from "./HeroCanvas.jsx";
import { CopyButton, Magnetic } from "../ui/primitives.jsx";
import Icon from "../ui/Icon.jsx";

export default function Hero() {
  const { t } = useHomeLocale();
  const ref = useRef(null);
  const [opened, setOpened] = useState(null);
  const [canAnimate, setCanAnimate] = useState(false);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);
  return (
    <section
      ref={ref}
      id="top"
      className="gateway-hero"
      aria-labelledby="hero-title"
    >
      <HeroCanvas
        progress={scrollYProgress}
        opened={opened}
        onAvailability={setCanAnimate}
      />
      <div className="gateway-hero-grid container">
        <motion.div className="gateway-copy" style={{ y: reduce ? 0 : y }}>
          <h1 id="hero-title">
            {t("Speak, friend, and")} <em>{t("enter.")}</em>
          </h1>
          <p className="gateway-pitch">
            {t(
              "Your AI providers. One gateway. OpenAI and Anthropic APIs, subscriptions, and local models — connected on your terms.",
            )}
          </p>
          <div className="gateway-actions">
            <Magnetic
              internal
              href="#demo"
              className="btn btn-primary btn-large"
            >
              {t("Open the live demo")}
              <Icon name="arrow" size={18} />
            </Magnetic>
            <Magnetic internal href="/docs" className="gateway-docs">
              {t("Read the docs")} <span aria-hidden="true">↗</span>
            </Magnetic>
          </div>
          <div
            className="gateway-install"
            role="group"
            aria-label={t("Install command")}
          >
            <span aria-hidden="true">$</span>
            <code>npm install -g durindoor</code>
            <CopyButton text="npm install -g durindoor" label={t("Install")} />
          </div>
        </motion.div>
        <div className="gateway-art">
          {canAnimate ? (
            <button
              type="button"
              className="gate-toggle"
              aria-pressed={opened === true}
              onClick={() => setOpened(opened !== true)}
            >
              {t(opened === true ? "Close the door" : "Open the door")}{" "}
              <Icon name="arrow" size={16} />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
