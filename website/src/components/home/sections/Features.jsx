"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { FEATURES } from "../data.js";
import Icon from "../ui/Icon.jsx";
import { Reveal, SectionHeader, spotlight } from "../ui/primitives.jsx";

export default function Features() {
  const { t } = useHomeLocale();
  return (
    <section id="features" className="section section-features" aria-labelledby="features-title">
      <div className="container">
        <SectionHeader
          eyebrow={t("What the door guards")}
          title={<span id="features-title">{t("Everything between your tools and your providers")}</span>}
          lead={t("Credentials, routing, fallbacks, translation and the ledger of every call, all on hardware you control.")}
        />
        <ul className="feature-grid">
          {FEATURES.map((feature, i) => (
            <Reveal
              as="li"
              key={feature.title}
              delay={(i % 4) * 0.06}
              className={`feature-card ${feature.wide ? "is-wide" : ""}`}
            >
              <div className="feature-inner" onPointerMove={spotlight}>
                <div className="feature-top">
                  <span className="feature-icon">
                    <Icon name={feature.icon} size={22} />
                  </span>
                  <span className="feature-n">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3>{t(feature.title)}</h3>
                <p>{t(feature.body)}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
