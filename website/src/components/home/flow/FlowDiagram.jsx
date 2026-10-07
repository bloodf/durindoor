"use client";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import BrandMark from "@site/components/brand/BrandMark.jsx";
export default function FlowDiagram() {
  const { t } = useHomeLocale();
  return (
    <div className="request-path">
      <div className="request-clients">
        <h3>{t("Compatible tools")}</h3>
        <ul>
          {["Claude Code", "Codex", "Cursor", "Cline"].map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
      <span className="request-arrow" aria-hidden="true">
        →
      </span>
      <div className="request-gateway">
        <div>
          <BrandMark size={42} />
          <h3>DurinDoor</h3>
        </div>
        <p>OpenAI / Anthropic APIs</p>
        <code>/v1/chat/completions</code>
        <code>/v1/responses</code>
        <code>/v1/messages</code>
      </div>
      <span className="request-arrow" aria-hidden="true">
        →
      </span>
      <div className="request-providers">
        <h3>{t("Providers")}</h3>
        <ul>
          {[
            "OpenAI",
            "Anthropic",
            "Gemini",
            "OpenRouter",
            "DeepSeek",
            "Ollama",
          ].map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <a href="#providers">{t("providers in the registry")} ↗</a>
      </div>
    </div>
  );
}
