"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { REGISTRY_PROVIDER_COUNT, SERVICE_KINDS } from "../content.js";
import Icon from "../ui/Icon.jsx";
import { CountUp, Reveal, SectionHeader, spotlight } from "../ui/primitives.jsx";

const MAX = Math.max(...SERVICE_KINDS.map((kind) => kind.count));

// Log scale so a kind with 4 providers still shows a visible sliver next to 195.
// Rounded to a string so server and client render identical inline styles.
const share = (count) => Math.max(0.08, Math.log(count + 1) / Math.log(MAX + 1)).toFixed(3);

export default function ServiceKinds() {
  const { t } = useHomeLocale();
  return (
    <section id="kinds" className="section section-kinds" aria-labelledby="kinds-title">
      <div className="kinds-dawn" aria-hidden="true" />
      <div className="container">
        <SectionHeader
          eyebrow={t("One door, every provider")}
          title={<span id="kinds-title">{t("Not just chat. Every kind of model call.")}</span>}
          lead={t("The same key and base URL reach chat, embeddings, speech, images, video and the web. Whatever the modality, it walks through the same door.")}
        />

        <Reveal className="kinds-total">
          <span className="kinds-total-n">
            <CountUp to={REGISTRY_PROVIDER_COUNT} className="count" />
          </span>
          <span className="kinds-total-label">{t("providers in the registry")}<small>{t("OAuth logins, API keys, web cookies, free tiers and local runtimes")}</small>
          </span>
        </Reveal>

        <ul className="kinds-grid">
          {SERVICE_KINDS.map((kind, i) => (
            <Reveal as="li" key={kind.id} delay={(i % 3) * 0.07} className="kind-card">
              <div className="kind-inner" onPointerMove={spotlight}>
                <div className="kind-top">
                  <span className="kind-icon">
                    <Icon name={kind.icon} size={22} />
                  </span>
                  <span className="kind-count">
                    <CountUp to={kind.count} duration={1.2} className="count" />
                    <span>{" "}{t("providers")}</span>
                  </span>
                </div>
                <h3>{t(kind.label)}</h3>
                <code className="kind-route">{kind.id === "vision" ? t("image input") : kind.route}</code>
                <span className="kind-bar" aria-hidden="true">
                  <span style={{ "--share": share(kind.count), "--i": String(i) }} />
                </span>
              </div>
            </Reveal>
          ))}
        </ul>
        <p className="kinds-note">{t("Provider counts come from the DurinDoor provider registry. Support for each modality depends on the provider.")}</p>
      </div>
    </section>
  );
}
