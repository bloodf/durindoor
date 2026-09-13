import { PROVIDERS, TOOLS } from "../data.js";
import { SectionHeader } from "../ui/primitives.jsx";

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
  return (
    <section id="tools" className="section section-tools" aria-labelledby="tools-title">
      <div className="container">
        <SectionHeader
          eyebrow="Compatible tools"
          title={<span id="tools-title">If it speaks OpenAI, it walks through</span>}
          lead="Coding agents, editors and CLIs connect with one base URL. Upstream, pick from a long list of providers."
        />
      </div>
      <Track
        label="Compatible tools"
        items={TOOLS}
        renderItem={(tool) => (
          <li key={tool.name} className="tool-chip">
            <span className="logo-chip"><img src={tool.logo} alt="" width="28" height="28" loading="lazy" /></span>
            <span>{tool.name}</span>
          </li>
        )}
      />
      <Track
        reverse
        label="Supported providers"
        items={PROVIDERS}
        renderItem={(p) => (
          <li key={p.id} className="provider-chip">
            <span className="logo-chip is-large">
              <img src={p.logo} alt={p.id} width="34" height="34" loading="lazy" />
            </span>
          </li>
        )}
      />
    </section>
  );
}
