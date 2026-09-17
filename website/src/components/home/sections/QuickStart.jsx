"use client";

import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";

import { CopyButton, Magnetic, Reveal, SectionHeader } from "../ui/primitives.jsx";
import DeployTabs from "./DeployTabs.jsx";

const CURL = `curl http://localhost:20128/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "MODEL_ID",
    "messages": [
      {"role": "user", "content": "Reply with one short sentence."}
    ],
    "max_tokens": 32
  }'`;

function Code({ label, copy, children }) {
  return (
    <div className="code-block">
      <div className="code-bar">
        <span className="code-label">{label}</span>
        <CopyButton text={copy} />
      </div>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

const STEPS = [
  {
    n: "I",
    title: "Install the CLI",
    body: "Node.js 20.20.2 and npm 10.8.2. One global package, no accounts.",
    code: (
      <Code label="shell" copy="npm install -g durindoor">
        <span className="c-dim">$ </span>
        <span className="c-cmd">npm</span> install -g <span className="c-str">durindoor</span>
      </Code>
    ),
  },
  {
    n: "II",
    title: "Open the door",
    body: "First run creates DATA_DIR and the database, then serves the dashboard.",
    code: (
      <Code label="shell" copy="durindoor">
        <span className="c-dim">$ </span>
        <span className="c-cmd">durindoor</span>
        {"\n"}
        <span className="c-ok">✓</span> <span className="c-dim">dashboard </span> http://localhost:20128/dashboard
        {"\n"}
        <span className="c-ok">✓</span> <span className="c-dim">api base  </span> http://localhost:20128/v1
      </Code>
    ),
  },
  {
    n: "III",
    title: "Send a request",
    body: "Add a provider, create a key, and use any model, alias or combo name.",
    code: (
      <Code label="curl" copy={CURL}>
        {CURL.split("\n").map((line, i) => (
          <span key={i}>
            {i === 0 ? <span className="c-cmd">curl </span> : null}
            <span className={line.includes('"') ? "c-str" : undefined}>{i === 0 ? line.slice(5) : line}</span>
            {"\n"}
          </span>
        ))}
      </Code>
    ),
  },
];

export default function QuickStart() {
  const { t } = useHomeLocale();
  return (
    <section id="quick-start" className="section section-quick" aria-labelledby="quick-title">
      <div className="container">
        <SectionHeader
          eyebrow={t("Quick start")}
          title={<span id="quick-title">{t("Three steps to the other side")}</span>}
          lead={t("Install, start, and point any OpenAI-compatible client at one base URL.")}
        />
        <ol className="quick-steps">
          {STEPS.map((step, i) => (
            <Reveal as="li" key={step.n} delay={i * 0.1} className="quick-step">
              <div className="quick-meta">
                <span className="quick-n" aria-hidden="true">{step.n}</span>
                <div>
                  <h3>{t(step.title)}</h3>
                  <p>{t(step.body)}</p>
                </div>
              </div>
              {step.code}
            </Reveal>
          ))}
        </ol>
        <Reveal className="connect-card">
          <p className="connect-title">{t("Connect your tools")}</p>
          <dl className="connect-grid">
            <div><dt>{t("Base URL")}</dt><dd><code>http://localhost:20128/v1</code></dd></div>
            <div><dt>{t("API key")}</dt><dd><code>{t("your DurinDoor API key")}</code></dd></div>
            <div><dt>{t("Model")}</dt><dd><code>{t("model ID, alias, or combo")}</code></dd></div>
          </dl>
        </Reveal>
        <Reveal>
          <Magnetic href="/docs/getting-started" internal className="btn btn-ghost">
            {t("Read the docs")}
          </Magnetic>
        </Reveal>
        <Reveal>
          <DeployTabs />
        </Reveal>
      </div>
    </section>
  );
}
