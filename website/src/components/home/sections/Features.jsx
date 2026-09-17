"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import Link from "next/link";
import { FEATURES } from "../data.js";
import Icon from "../ui/Icon.jsx";
import { Reveal, SectionHeader, spotlight } from "../ui/primitives.jsx";

export default function Features() {
  const { t } = useHomeLocale();
  return (
    <section id="features" className="section section-features" aria-labelledby="features-title">
      <div className="container">
        <SectionHeader
          eyebrow={t("Also on this machine")}
          title={<span id="features-title">{t("MCP, realtime, proxy traces, tunnels")}</span>}
          lead={t("Each card opens the matching docs page.")}
        />
        <ul className="feature-grid">
          {FEATURES.map((feature, i) => (
            <Reveal
              as="li"
              key={feature.title}
              delay={(i % 4) * 0.06}
              className={`feature-card ${feature.wide ? "is-wide" : ""}`}
            >
              <Link
                href={feature.href}
                className="feature-inner"
                onPointerMove={spotlight}
                style={{ display: "block", color: "inherit", textDecoration: "none" }}
              >
                <div className="feature-top">
                  <span className="feature-icon">
                    <Icon name={feature.icon} size={22} />
                  </span>
                  <span className="feature-n">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3>{t(feature.title)}</h3>
                <p>{t(feature.body)}</p>
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
