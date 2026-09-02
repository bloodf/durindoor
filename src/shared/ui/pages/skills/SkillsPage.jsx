import { useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Select from "@/shared/ui/components/Select.jsx";

import { apiKeyOptions, endpointOptions, entrySkill, skills } from "./mockData.js";

async function safeClipboardWrite(text) {
  if (!globalThis.navigator?.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label, copiedLabel, variant = "secondary", size = "sm" }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleClick = async () => {
    const ok = await safeClipboardWrite(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    }
  };

  const icon = failed ? "error" : copied ? "check" : "content_copy";
  const visibleLabel = failed ? "Copy failed" : copied ? copiedLabel : label;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      icon={icon}
      onClick={handleClick}
      aria-label={visibleLabel}
    >
      {visibleLabel}
    </Button>
  );
}

/** Builds a copy-ready curl request from the selected mock endpoint and key. */
function PreviewCard({ initialEndpoint, initialApiKey, initialCustomEndpoint }) {
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [customEndpoint, setCustomEndpoint] = useState(initialCustomEndpoint);
  const baseUrl = (endpoint === "custom" ? customEndpoint : endpoint).replace(/\/+$/, "");
  const snippet = [
    `curl -X POST ${baseUrl}/chat/completions \\`,
    apiKey ? `  -H "Authorization: Bearer ${apiKey}" \\` : null,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"cx/gpt-5.6-sol","messages":[{"role":"user","content":"Hello"}]}'`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Card padding={false}>
      <CardHeader
        icon="content_copy"
        title="Preview & copy"
        subtitle="Choose an endpoint and API key, then paste the rendered request."
      />
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Endpoint">
            <Select
              options={endpointOptions}
              value={endpoint}
              onChange={setEndpoint}
              className="font-mono"
              aria-label="Endpoint"
            />
          </Field>
          <Field label="API key">
            <Select
              options={apiKeyOptions}
              value={apiKey}
              onChange={setApiKey}
              className="font-mono"
              aria-label="API key"
            />
          </Field>
        </div>
        {endpoint === "custom" ? (
          <Input
            label="Custom endpoint URL"
            value={customEndpoint}
            onChange={(event) => setCustomEndpoint(event.target.value)}
            placeholder="https://gateway.example.com/v1"
            className="font-mono"
          />
        ) : null}
        <pre className="dd-tnum overflow-x-auto rounded-dd bg-dd-surface-2 p-4 font-mono text-xs leading-5 text-dd-text">
          <code>{snippet}</code>
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!apiKey ? (
            <Badge tone="warning" size="sm" icon="warning">
              keyless — works only when Require API key is off
            </Badge>
          ) : (
            <span />
          )}
          <CopyButton
            text={snippet}
            label="Copy snippet"
            copiedLabel="Copied!"
            variant="primary"
            size="md"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function IntroCard() {
  const introText = `Read this skill and use it: ${entrySkill.url}`;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[20px] leading-none text-dd-accent"
          >
            bolt
          </span>
          <span className="text-sm font-semibold text-dd-text">One-line handoff</span>
        </div>
        <p className="text-[13px] leading-5 text-dd-muted">
          Copy a link and paste to your AI to use DurinDoor — no install needed.
        </p>
        <div className="flex flex-col gap-2 rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <code className="block min-w-0 flex-1 truncate whitespace-pre-wrap break-all font-mono text-xs text-dd-text">
            {introText}
          </code>
          <CopyButton text={introText} label="Copy link" copiedLabel="Copied" />
        </div>
      </div>
    </Card>
  );
}

function SkillRow({ skill, isEntry }) {
  return (
    <Card padding={false}>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-4">
        <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-0">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"
          >
            <span className="material-symbols-outlined text-[22px] leading-none">{skill.icon}</span>
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-dd-text">{skill.name}</span>
            {isEntry ? (
              <Badge tone="accent" size="sm">
                {skill.badge}
              </Badge>
            ) : null}
            {skill.endpoint ? (
              <Badge tone="neutral" size="sm" className="font-mono">
                {skill.endpoint}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-dd-muted">{skill.description}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <code
              title={skill.url}
              className="block min-w-0 flex-1 truncate rounded-dd bg-dd-surface-2 px-2 py-1 font-mono text-xs text-dd-text"
            >
              {skill.url}
            </code>
            <div className="flex shrink-0 items-center gap-1.5">
              <a
                href={skill.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-dd border border-dd-border bg-dd-surface-2 px-2.5 text-xs font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
                aria-label={`Open ${skill.name} skill in a new tab`}
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[16px] leading-none"
                >
                  open_in_new
                </span>
                <span>Open</span>
              </a>
              <CopyButton text={skill.url} label="Copy link" copiedLabel="Copied" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SkillsPage({
  initialEndpoint = endpointOptions[0].value,
  initialApiKey = apiKeyOptions[0].value,
  initialCustomEndpoint = "https://gateway.example.com/v1",
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        icon="extension"
        title="Agent Skills"
        subtitle="Copy a link and paste to your AI to use DurinDoor — no install needed"
      />

      <PreviewCard
        initialEndpoint={initialEndpoint}
        initialApiKey={initialApiKey}
        initialCustomEndpoint={initialCustomEndpoint}
      />
      <IntroCard />
      <div className="flex flex-col gap-3">
        {skills.map((skill) => (
          <SkillRow
            key={skill.name}
            skill={skill}
            isEntry={skill.name === entrySkill.name}
          />
        ))}
      </div>
    </div>
  );
}
