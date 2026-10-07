"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import Link from "next/link";
import { FEATURES } from "../data.js";
import BrandMark from "@site/components/brand/BrandMark.jsx";
import Icon from "../ui/Icon.jsx";
import { Reveal, SectionHeader, spotlight } from "../ui/primitives.jsx";

function FeatureIllustration({ kind }) {
  if (kind === "hub")
    return (
      <div className="feature-art mcp-art" aria-hidden="true">
        <div className="mcp-origin">
          <BrandMark size={36} />
          <code>DurinDoor</code>
        </div>
        <div className="mcp-branches">
          <span>HTTP</span>
          <span>SSE</span>
          <span>stdio</span>
        </div>
        <div className="mcp-tools">
          <code>tools/list</code>
          <code>tools/call</code>
        </div>
      </div>
    );
  if (kind === "chat")
    return (
      <div className="feature-art realtime-art" aria-hidden="true">
        <code>GET /v1/realtime</code>
        <div className="text-stream">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="stream-caret" />
      </div>
    );
  if (kind === "route")
    return (
      <div className="feature-art trace-art" aria-hidden="true">
        <div>
          <span>01</span>
          <i />
        </div>
        <div>
          <span>02</span>
          <i />
        </div>
        <div>
          <span>03</span>
          <i />
        </div>
        <code>→ → →</code>
      </div>
    );
  return (
    <div className="feature-art tunnel-art" aria-hidden="true">
      <span>HTTPS</span>
      <div className="tunnel-path">
        <i />
        <BrandMark size={42} />
        <i />
      </div>
      <div className="tunnel-providers">
        <span>Cloudflare</span>
        <span>Tailscale</span>
      </div>
    </div>
  );
}

export default function Features() {
  const { t } = useHomeLocale();
  return (
    <section
      id="features"
      className="section section-features"
      aria-labelledby="features-title"
    >
      <div className="container">
        <SectionHeader
          eyebrow={t("Also on this machine")}
          title={
            <span id="features-title">
              {t("MCP, realtime, proxy traces, tunnels")}
            </span>
          }
          lead={t("Each card opens the matching docs page.")}
        />
        <ul className="feature-grid">
          {FEATURES.map((feature, i) => (
            <Reveal
              as="li"
              key={feature.title}
              delay={(i % 4) * 0.06}
              className={`feature-card feature-${feature.icon}`}
            >
              <Link
                href={feature.href}
                className="feature-inner"
                onPointerMove={spotlight}
                style={{
                  display: "block",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <FeatureIllustration kind={feature.icon} />
                <div className="feature-top">
                  <span className="feature-icon">
                    <Icon name={feature.icon} size={22} />
                  </span>
                  <span aria-hidden="true">↗</span>
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
