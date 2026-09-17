"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import FlowDiagram from "./FlowDiagram.jsx";
import ModelResolver from "./ModelResolver.jsx";
import FallbackTiers from "./FallbackTiers.jsx";
import ThreeStage from "../threeui/ThreeStage.jsx";
import { DocsCta, Reveal, SectionHeader } from "../ui/primitives.jsx";

const STEPS = [
  { n: "01", title: "Knock", body: "A tool sends a /v1 request with a DurinDoor key and a model string." },
  { n: "02", title: "Resolve", body: "The key is checked, the model resolved, and a healthy connection chosen." },
  { n: "03", title: "Translate", body: "Formats are bridged both ways; the upstream call uses stored credentials." },
  { n: "04", title: "Record", body: "Usage, latency and outcome land in local SQLite. Switch the engine to Postgres when you outgrow the file." },
];

export default function FlowSection() {
  const { t } = useHomeLocale();
  return (
    <section id="how" className="section section-flow" aria-labelledby="how-title">
      {/* ThreeUI StreamConvergenceBackground: many streams converging on one gateway. Hue-rotated from violet to emerald. */}
      <ThreeStage effect="stream" className="flow-streams" hue={-150} saturation={0.9} brightness={0.75} speed={0.6} />
      <div className="container">
        <SectionHeader
          eyebrow={t("How it works")}
          title={<span id="how-title">{t("Every request passes one door")}</span>}
          lead={t("Clients post OpenAI /v1/chat/completions or /v1/responses, or Anthropic /v1/messages. DurinDoor translates, picks a healthy account, and records the outcome.")}
        />
        <Reveal className="flow-frame">
          <FlowDiagram />
        </Reveal>
        <div className="flow-split">
          <ol className="flow-steps">
            {STEPS.map((step, i) => (
              <Reveal as="li" key={step.n} delay={i * 0.08} className="flow-step">
                <span className="flow-step-n">{step.n}</span>
                <div>
                  <h3>{t(step.title)}</h3>
                  <p>{t(step.body)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Reveal delay={0.15}>
            <ModelResolver />
          </Reveal>
        </div>
        <Reveal>
          <FallbackTiers />
        </Reveal>
        <DocsCta href="/docs/features/smart-routing" />
      </div>
    </section>
  );
}
