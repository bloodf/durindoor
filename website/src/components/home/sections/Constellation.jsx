import { CONSTELLATION, REGISTRY_PROVIDER_COUNT, constellationLogo } from "../content.js";
import ThreeStage from "../threeui/ThreeStage.jsx";
import { BrandMark } from "../ui/chrome.jsx";
import { Reveal, SectionHeader } from "../ui/primitives.jsx";

const RINGS = [
  { id: "inner", radius: 20, duration: 70 },
  { id: "middle", radius: 32, duration: 110, reverse: true },
  { id: "outer", radius: 45, duration: 160 },
];

// Three CSS orbits of real provider logos around the door. Each logo sits on a
// rotating ring and counter-rotates so it stays upright. Pure CSS, no JS.
function Ring({ ids, radius, duration, reverse }) {
  return (
    <ul
      className={`orbit ${reverse ? "is-reverse" : ""}`}
      style={{ "--radius": `${radius}cqw`, "--duration": `${duration}s` }}
    >
      {ids.map((id, i) => (
        <li key={id} className="orbit-item" style={{ "--angle": `${(360 / ids.length) * i}deg` }}>
          <span className="orbit-logo">
            <img src={constellationLogo(id)} alt={id} width="30" height="30" loading="lazy" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Constellation() {
  return (
    <section id="providers" className="section section-constellation" aria-labelledby="providers-title">
      <div className="container constellation-layout">
        <div className="constellation-copy">
          <SectionHeader
            align="start"
            eyebrow="The fellowship"
            title={<span id="providers-title">Every provider, bound to one ring</span>}
            lead="Connect OAuth subscriptions, API keys, web cookies, OpenAI- or Anthropic-compatible endpoints and local runtimes. Tools never learn which one answered."
          />
          <Reveal as="dl" className="constellation-facts">
            <div>
              <dt>Registry</dt>
              <dd>{REGISTRY_PROVIDER_COUNT} providers</dd>
            </div>
            <div>
              <dt>Custom nodes</dt>
              <dd>Any compatible URL</dd>
            </div>
            <div>
              <dt>Local</dt>
              <dd>No remote account</dd>
            </div>
          </Reveal>
        </div>

        <Reveal className="constellation-stage">
          {/* ThreeUI LaserCollection "vanishing-array": rails converging on a single point, tuned to gold and teal. */}
          <ThreeStage effect="laser" variant="vanishing-array" hue={170} saturation={0.75} density={0.8} speed={0.5} />
          <div className="constellation-sky">
            {RINGS.map((ring) => (
              <Ring key={ring.id} ids={CONSTELLATION[ring.id]} radius={ring.radius} duration={ring.duration} reverse={ring.reverse} />
            ))}
            <div className="constellation-core">
              <BrandMark size={44} />
              <span>DurinDoor</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
