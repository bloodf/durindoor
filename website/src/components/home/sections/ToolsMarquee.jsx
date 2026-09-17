"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import Link from "next/link";
import { TOOLS } from "../data.js";
import { DocsCta, SectionHeader } from "../ui/primitives.jsx";

// Two CSS marquees in opposite directions. The duplicate track is aria-hidden,
// and reduced motion stops the animation and lets the row wrap instead.
function Track({ items, reverse, renderItem, label }) {
  return (
    <div className={`marquee ${reverse ? "is-reverse" : ""}`}>
      <ul className="marquee-track" aria-label={label}>
        {items.map(renderItem)}
      </ul>
      <ul className="marquee-track is-clone" aria-hidden="true">
        {items.map(renderItem)}
      </ul>
    </div>
  );
}

export default function ToolsMarquee() {
  const { t } = useHomeLocale();
  return (
    <section id="tools" className="section section-tools" aria-labelledby="tools-title">
      <div className="container">
        <SectionHeader
          eyebrow={t("Compatible tools")}
          title={<span id="tools-title">{t("If it speaks OpenAI, it walks through")}</span>}
          lead={t("Claude Code, Codex, Cursor, Cline, Roo, and Continue have setup pages. Anything that speaks OpenAI uses the same base URL.")}
        />
      </div>
      <Track
        label={t("Compatible tools")}
        items={TOOLS}
        renderItem={(tool) => (
          <li key={tool.name} className="tool-chip">
            {tool.href ? (
              <Link href={tool.href} style={{ display: "inline-flex", alignItems: "center", gap: "inherit", color: "inherit", textDecoration: "none" }}>
                <span className="logo-chip"><img src={tool.logo} alt="" width="28" height="28" loading="lazy" /></span>
                <span>{tool.name}</span>
              </Link>
            ) : (
              <>
                <span className="logo-chip"><img src={tool.logo} alt="" width="28" height="28" loading="lazy" /></span>
                <span>{tool.name}</span>
              </>
            )}
          </li>
        )}
      />
      <div className="container">
        <DocsCta href="/docs/integrations" />
      </div>
    </section>
  );
}
