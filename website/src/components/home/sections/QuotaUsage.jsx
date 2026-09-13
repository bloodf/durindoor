"use client";

import { motion } from "motion/react";
import { QUOTA_SAMPLE } from "../content.js";
import ThreeStage from "../threeui/ThreeStage.jsx";
import Icon from "../ui/Icon.jsx";
import { CountUp, Reveal, SectionHeader } from "../ui/primitives.jsx";

const R = 52;
const CIRCUMFERENCE = 2 * Math.PI * R;

function Gauge({ account, index }) {
  const tone = account.used > 0.75 ? "is-hot" : account.used > 0.4 ? "is-warm" : "is-cool";
  return (
    <Reveal as="li" delay={index * 0.1} className={`gauge ${tone}`}>
      <div className="gauge-dial">
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <circle cx="64" cy="64" r={R} className="gauge-track" />
          <motion.circle
            cx="64"
            cy="64"
            r={R}
            className="gauge-fill"
            strokeDasharray={CIRCUMFERENCE}
            initial={{ strokeDashoffset: CIRCUMFERENCE }}
            whileInView={{ strokeDashoffset: CIRCUMFERENCE * (1 - account.used) }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 1.6, delay: 0.2 + index * 0.15, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <span className="gauge-value">
          <CountUp to={Math.round(account.used * 100)} format={(n) => `${Math.round(n)}%`} className="count" />
          <small>used</small>
        </span>
      </div>
      <div className="gauge-meta">
        <span className="logo-chip is-small">
          <img src={account.logo} alt="" width="22" height="22" loading="lazy" />
        </span>
        <div>
          <p className="gauge-name">{account.name}</p>
          <p className="gauge-plan">
            {account.plan} · {account.reset}
          </p>
        </div>
      </div>
    </Reveal>
  );
}

const LEDGER = [
  { icon: "chart", text: "Provider, model, tokens, cost estimate and latency for every request" },
  { icon: "layers", text: "Which model served each request, and the fallback outcome" },
  { icon: "gauge", text: "Provider limits and reset windows side by side" },
];

export default function QuotaUsage() {
  return (
    <section id="quota" className="section section-quota" aria-labelledby="quota-title">
      {/* ThreeUI EmeraldHorizonBackground: the green dawn line under the ledger. */}
      <ThreeStage effect="horizon" className="quota-horizon" speed={0.5} glow={0.8} />
      <div className="container">
        <SectionHeader
          eyebrow="The ledger"
          title={<span id="quota-title">Know which account still has room</span>}
          lead="DurinDoor records every call in local SQLite and tracks provider limits and reset windows, so you can see which account still has headroom before a tool hits a wall."
        />
        <div className="quota-layout">
          <div className="gauges-wrap">
            <span className="sample-tag">Sample data</span>
            <ul className="gauges" aria-label="Example quota usage">
              {QUOTA_SAMPLE.map((account, i) => (
                <Gauge key={account.name} account={account} index={i} />
              ))}
            </ul>
          </div>
          <Reveal className="quota-ledger" delay={0.2}>
            <p className="quota-ledger-title">In the dashboard</p>
            <ul>
              {LEDGER.map((item) => (
                <li key={item.text}>
                  <Icon name={item.icon} size={18} />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
