"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { FALLBACK_TIERS, STICKY_LIMIT } from "../content.js";

// One scripted request per loop: tier I is rate limited, tier II answers.
// Each frame is [active tier, outcome of tier I, outcome of tier II].
const SCRIPT = [
  { active: 0, states: ["trying", "idle", "idle"], log: "try 1  cc/claude-sonnet" },
  { active: 0, states: ["failed", "idle", "idle"], log: "429    rate limited, account locked with backoff" },
  { active: 1, states: ["failed", "trying", "idle"], log: "try 2  openrouter/qwen3-coder" },
  { active: 1, states: ["failed", "served", "idle"], log: "200    served by tier II" },
];
const FRAME_MS = 1300;
const ACCOUNTS = ["Account A", "Account B", "Account C"];
const STATUS_TEXT = { idle: "standing by", trying: "trying", failed: "429", served: "200 OK" };

function useTicker(active, ms) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return tick;
}

function Tiers({ frame }) {
  const { t } = useHomeLocale();
  return (
    <ol className="tiers">
      {FALLBACK_TIERS.map((tier, i) => {
        const state = frame.states[i];
        return (
          <li key={tier.name} className={`tier is-${state} ${frame.active === i ? "is-active" : ""}`}>
            <div className="tier-head">
              <span className="tier-rank">{t(tier.tier)}</span>
              <span className="tier-status">{state === "idle" || state === "trying" ? t(STATUS_TEXT[state]) : STATUS_TEXT[state]}</span>
            </div>
            <div className="tier-name">
              <span className="logo-chip is-small">
                <img src={tier.logo} alt="" width="22" height="22" loading="lazy" />
              </span>
              <h3>{t(tier.name)}</h3>
            </div>
            <p>{t(tier.body)}</p>
            <code>{tier.model}</code>
            {i < FALLBACK_TIERS.length - 1 ? <span className="tier-link" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function StickyRoundRobin({ tick }) {
  const { t } = useHomeLocale();
  const request = tick % (ACCOUNTS.length * STICKY_LIMIT);
  const account = Math.floor(request / STICKY_LIMIT);
  const uses = (request % STICKY_LIMIT) + 1;
  return (
    <div className="sticky-rr">
      <p className="sticky-rr-title">{t("Sticky round-robin")}{" "}<span>{t("rotate after {count} uses, or pin a session to one account", { count: STICKY_LIMIT })}</span>
      </p>
      <ul className="sticky-rr-accounts">
        {ACCOUNTS.map((name, i) => (
          <li key={name} className={i === account ? "is-current" : ""}>
            <span className="sticky-rr-name">{t(name)}</span>
            <span className="sticky-rr-pips" aria-hidden="true">
              {Array.from({ length: STICKY_LIMIT }, (_, pip) => (
                <i key={pip} className={i === account && pip < uses ? "is-on" : ""} />
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FallbackTiers() {
  const { t } = useHomeLocale();
  const ref = useRef(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const prefersReduced = useReducedMotion();
  // The server cannot know the preference; apply it only after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reduce = mounted && prefersReduced;
  const tick = useTicker(inView && mounted && !prefersReduced, FRAME_MS);
  // Reduced motion shows the resolved outcome instead of cycling.
  const frame = reduce ? SCRIPT[SCRIPT.length - 1] : SCRIPT[tick % SCRIPT.length];

  return (
    <div className="fallback" ref={ref}>
      <div className="fallback-copy">
        <p className="eyebrow">{t("Three tiers of fallback")}</p>
        <h3 className="fallback-title">{t("When one door is shut, try the next.")}</h3>
        <p className="fallback-lead">{t("Put a subscription first, a cheap API second and a free or local model last. A combo keeps one stable model name; when a member fails, DurinDoor retries other accounts for it, then falls through to the next member.")}</p>
        <p className="fallback-log" aria-live="off">
          <span className="fallback-log-dot" aria-hidden="true" />
          <code>{t(frame.log)}</code>
        </p>
        <StickyRoundRobin tick={reduce ? 0 : tick} />
      </div>
      <Tiers frame={frame} />
    </div>
  );
}
