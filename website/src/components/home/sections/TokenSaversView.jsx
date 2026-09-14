"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { SAVER_ENGINES } from "../content.js";
import ThreeStage from "../threeui/ThreeStage.jsx";
import { CountUp, Reveal, SectionHeader } from "../ui/primitives.jsx";


function Pane({ label, meta, text, tone }) {
  const { t } = useHomeLocale();
  return (
    <div className={`saver-pane is-${tone}`}>
      <div className="code-bar">
        <span className="code-label">{label}</span>
        <span className="saver-meta">{meta}</span>
      </div>
      <pre tabIndex={0} aria-label={t("{label} output", { label })}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export default function TokenSaversView({ raw, compressed, before, after }) {
  const { t, locale } = useHomeLocale();
  const signed = (n) => `−${Math.round(Math.abs(n)).toLocaleString(locale)}`;
  const saved = before - after;
  const percent = Math.round((saved / before) * 100);

  return (
    <section id="savers" className="section section-savers" aria-labelledby="savers-title">
      <div className="container">
        <SectionHeader
          eyebrow={t("Token savers")}
          title={<span id="savers-title">{t("Say less. Mean the same.")}</span>}
          lead={t("Opt-in compression trims prompts after translation and before they leave your machine. It fails open: if an engine errors, the original request goes through untouched.")}
        />

        <Reveal className="saver-stats">
          <div className="saver-stat">
            <span className="saver-stat-n">
              <CountUp to={saved} format={signed} className="count" />
            </span>
            <span className="saver-stat-label">{t("bytes removed from this tool result")}</span>
          </div>
          <div className="saver-stat is-gold">
            <span className="saver-stat-n">
              <CountUp to={percent} format={(n) => `${Math.round(n)}%`} className="count" />
            </span>
            <span className="saver-stat-label">{t("smaller: grouped by folder, long lists capped")}</span>
          </div>
        </Reveal>

        <Reveal className="saver-stage">
          <Pane label="find . -type f" meta={t("{count} bytes", { count: before.toLocaleString(locale) })} text={raw} tone="raw" />
          <div className="saver-blade">
            {/* ThreeUI LaserCollection "atmospheric-blade": the emerald beam the output passes through. */}
            <ThreeStage effect="laser" variant="atmospheric-blade" size={1.2} density={1.1} speed={0.8} />
            <span className="saver-blade-label">RTK</span>
          </div>
          <Pane label={t("after RTK find filter")} meta={t("{count} bytes", { count: after.toLocaleString(locale) })} text={compressed} tone="lean" />
        </Reveal>
        <p className="saver-caption">
          {t("Real output of DurinDoor's RTK")}{" "}<code>find</code>{" "}{t("filter, using the sample file list.")}
        </p>

        <ul className="saver-engines">
          {SAVER_ENGINES.map((engine, i) => (
            <Reveal as="li" key={engine.name} delay={i * 0.06} className="saver-engine">
              <h3>{t(engine.name)}</h3>
              <p>{t(engine.body)}</p>
            </Reveal>
          ))}
        </ul>
        <Reveal className="saver-bypass">
          <span>{t("Need the raw prompt for one call?")}</span>
          <code>X-DurinDoor-Token-Saver: off</code>
        </Reveal>
      </div>
    </section>
  );
}
