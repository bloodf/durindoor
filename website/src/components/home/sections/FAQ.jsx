"use client";

import Link from "next/link";
import { useHomeLocale } from "@site/i18n/HomeLocaleProvider.jsx";
import { SectionHeader } from "../ui/primitives.jsx";

const questions = [
  ["Who is DurinDoor for?", "Developers and operators who want to connect their tools to multiple AI providers through one gateway.", "/docs/getting-started", "Get started"],
  ["Can I connect a model server on my network?", "Yes. Configure a network Ollama host or a LAN OpenAI-compatible server. Discovery and network access depend on your setup.", "/docs/providers/network-llm-servers", "Network LLM servers"],
  ["How do web provider sign-ins work?", "Supported providers offer dashboard sign-in or manual session import. A browser extension can capture approved cookies for supported providers using a one-use pairing.", "/docs/providers/web-cookie", "Web cookie providers"],
  ["Is DurinDoor open source?", "Yes. DurinDoor is an MIT-licensed fork of 9router. Browse the source and license on GitHub.", "https://github.com/bloodf/durindoor", "View on GitHub"],
];

export default function FAQ() {
  const { t } = useHomeLocale();
  return <section id="faq" className="section home-faq" aria-labelledby="faq-title">
    <div className="container">
      <SectionHeader eyebrow={t("FAQ")} title={<span id="faq-title">{t("Questions before you begin")}</span>} />
      <div className="faq-list">
        {questions.map(([question, answer, href, label]) => <details key={question}>
          <summary>{t(question)}</summary>
          <p>{t(answer)}</p>
          {href.startsWith("http") ? <a href={href}>{t(label)}</a> : <Link href={href}>{t(label)}</Link>}
        </details>)}
      </div>
    </div>
  </section>;
}
