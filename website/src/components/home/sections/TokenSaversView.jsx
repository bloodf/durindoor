"use client";

import { SAVER_ENGINES } from "../content.js";
import ThreeStage from "../threeui/ThreeStage.jsx";
import { CountUp, Reveal, SectionHeader } from "../ui/primitives.jsx";

const signed = (n) => `−${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

function Pane({ label, meta, text, tone }) {
  return (
    <div className={`saver-pane is-${tone}`}>
      <div className="code-bar">
        <span className="code-label">{label}</span>
        <span className="saver-meta">{meta}</span>
      </div>
      <pre tabIndex={0} aria-label={`${label} output`}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export default function TokenSaversView({ raw, compressed, before, after }) {
  const saved = before - after;
  const percent = Math.round((saved / before) * 100);

  return (
    <section id="savers" className="section section-savers" aria-labelledby="savers-title">
      <div className="container">
        <SectionHeader
          eyebrow="Token savers"
          title={<span id="savers-title">Say less. Mean the same.</span>}
          lead="Opt-in compression trims prompts after translation and before they leave your machine. It fails open: if an engine errors, the original request goes through untouched."
        />

        <Reveal className="saver-stats">
          <div className="saver-stat">
            <span className="saver-stat-n">
              <CountUp to={saved} format={signed} className="count" />
            </span>
            <span className="saver-stat-label">bytes removed from this tool result</span>
          </div>
          <div className="saver-stat is-gold">
            <span className="saver-stat-n">
              <CountUp to={percent} format={(n) => `${Math.round(n)}%`} className="count" />
            </span>
            <span className="saver-stat-label">smaller: grouped by folder, long lists capped</span>
          </div>
        </Reveal>

        <Reveal className="saver-stage">
          <Pane label="find . -type f" meta={`${before.toLocaleString("en-US")} bytes`} text={raw} tone="raw" />
          <div className="saver-blade">
            {/* ThreeUI LaserCollection "atmospheric-blade": the emerald beam the output passes through. */}
            <ThreeStage effect="laser" variant="atmospheric-blade" size={1.2} density={1.1} speed={0.8} />
            <span className="saver-blade-label">RTK</span>
          </div>
          <Pane label="after RTK find filter" meta={`${after.toLocaleString("en-US")} bytes`} text={compressed} tone="lean" />
        </Reveal>
        <p className="saver-caption">
          Real output of DurinDoor&apos;s RTK <code>find</code> filter, run when this page was built.
        </p>

        <ul className="saver-engines">
          {SAVER_ENGINES.map((engine, i) => (
            <Reveal as="li" key={engine.name} delay={i * 0.06} className="saver-engine">
              <h3>{engine.name}</h3>
              <p>{engine.body}</p>
            </Reveal>
          ))}
        </ul>
        <Reveal className="saver-bypass">
          <span>Need the raw prompt for one call?</span>
          <code>X-DurinDoor-Token-Saver: off</code>
        </Reveal>
      </div>
    </section>
  );
}
