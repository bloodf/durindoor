"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { motion } from "motion/react";
import { QUOTA_SAMPLE } from "../content.js";
import ThreeStage from "../threeui/ThreeStage.jsx";
import Icon from "../ui/Icon.jsx";
import { CountUp, DocsCta, Reveal, SectionHeader } from "../ui/primitives.jsx";

const R = 52;
const CIRCUMFERENCE = 2 * Math.PI * R;

function Gauge({ account, index }) {
  const { t } = useHomeLocale();
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
          <small>{t("used")}</small>
        </span>
      </div>
      <div className="gauge-meta">
        <span className="logo-chip is-small">
          <img src={account.logo} alt="" width="22" height="22" loading="lazy" />
        </span>
        <div>
          <p className="gauge-name">{account.name}</p>
          <p className="gauge-plan">
            {t(account.plan)} · {t(account.reset)}
          </p>
        </div>
      </div>
    </Reveal>
  );
}

const LEDGER = [
  { icon: "chart", text: "Provider, model, tokens, cost estimate and latency for every request" },
  { icon: "gauge", text: "Provider limits and reset windows side by side" },
  { icon: "layers", text: "Codex reset credits redeem against that account's exhausted windows" },
];

export default function QuotaUsage() {
  const { t } = useHomeLocale();
  return (
    <section id="quota" className="section section-quota" aria-labelledby="quota-title">
      {/* ThreeUI EmeraldHorizonBackground: the green dawn line under the ledger. */}
      <ThreeStage effect="horizon" className="quota-horizon" speed={0.5} glow={0.8} />
      <div className="container">
        <SectionHeader
          eyebrow={t("The ledger")}
          title={<span id="quota-title">{t("Know which account still has room")}</span>}
          lead={t("Quota views show provider limits, reset windows, and Codex reset credits.")}
        />
        <div className="quota-layout">
          <div className="gauges-wrap">
            <span className="sample-tag">{t("Sample data")}</span>
            <ul className="gauges" aria-label={t("Example quota usage")}>
              {QUOTA_SAMPLE.map((account, i) => (
                <Gauge key={account.name} account={account} index={i} />
              ))}
            </ul>
          </div>
          <Reveal className="quota-ledger" delay={0.2}>
            <p className="quota-ledger-title">{t("In the dashboard")}</p>
            <ul>
              {LEDGER.map((item) => (
                <li key={item.text}>
                  <Icon name={item.icon} size={18} />
                  <span>{t(item.text)}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <DocsCta href="/docs/features/quota-tracking" />
      </div>
    </section>
  );
}
