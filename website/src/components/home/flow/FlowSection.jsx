import FlowDiagram from "./FlowDiagram.jsx";
import ModelResolver from "./ModelResolver.jsx";
import { Reveal, SectionHeader } from "../ui/primitives.jsx";

const STEPS = [
  { n: "01", title: "Knock", body: "A tool sends a /v1 request with a DurinDoor key and a model string." },
  { n: "02", title: "Resolve", body: "The key is checked, the model resolved, and a healthy connection chosen." },
  { n: "03", title: "Translate", body: "Formats are bridged both ways; the upstream call uses stored credentials." },
  { n: "04", title: "Record", body: "Usage, latency and outcome land in local SQLite as the response streams back." },
];

export default function FlowSection() {
  return (
    <section id="how" className="section section-flow" aria-labelledby="how-title">
      <div className="container">
        <SectionHeader
          eyebrow="How it works"
          title={<span id="how-title">Every request passes one door</span>}
          lead="Your tools speak OpenAI. Your providers speak whatever they like. DurinDoor stands between them, holds the keys, and keeps the ledger."
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
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Reveal delay={0.15}>
            <ModelResolver />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
