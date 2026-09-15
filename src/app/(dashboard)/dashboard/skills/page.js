"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { SKILLS, SKILLS_REPO_URL, getSkillRawUrl, getSkillBlobUrl } from "@/shared/constants/skills";
import { buildSkillInstruction, revealKeySecret, useSkillTargets } from "./useSkillTargets";

const NO_KEY = "__none__";

function CopyButton({ value, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return <Button size="sm" variant="ghost" icon={copied ? "check" : "content_copy"} onClick={() => copy(value)} title={value}>{copied ? "Copied" : label}</Button>;
}

/**
 * Copies a ready-to-paste instruction: the skill URL plus the selected base URL
 * and, when a key is chosen, its secret.
 *
 * The secret is fetched at click time from `/api/keys/:id/reveal` and passed
 * straight to the clipboard. It is never held in component state, so it cannot
 * leak into a render, a devtools inspection, or a screenshot of this page.
 */
function CopyInstructionButton({ skillUrl, baseUrl, keyId, label = "Copy instruction" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  const [failed, setFailed] = useState(false);

  const handleCopy = async () => {
    setFailed(false);
    let apiKey = null;
    if (keyId && keyId !== NO_KEY) {
      apiKey = await revealKeySecret(keyId);
      if (!apiKey) {
        setFailed(true);
        return;
      }
    }
    copy(buildSkillInstruction({ skillUrl, baseUrl, apiKey }));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="primary" icon={copied ? "check" : "content_copy"} onClick={handleCopy}>
        {copied ? "Copied" : label}
      </Button>
      {failed ? <span role="alert" className="text-xs text-dd-danger">Could not read that key. Pick another.</span> : null}
    </div>
  );
}

function SkillRow({ skill, baseUrl, keyId }) {
  const url = getSkillRawUrl(skill.id);
  return <article className="flex flex-col gap-3 rounded-dd-lg border border-dd-border-subtle bg-dd-surface p-4 sm:flex-row sm:items-start">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">{skill.icon}</span></span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-[13px] font-semibold text-dd-text">{skill.name}</h2>{skill.isEntry ? <Badge tone="accent">START HERE</Badge> : null}{skill.endpoint ? <Badge tone="neutral">{skill.endpoint}</Badge> : null}</div><p className="mt-1 text-xs text-dd-muted">{skill.description}</p><a href={getSkillBlobUrl(skill.id)} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 break-all text-xs text-dd-accent outline-none focus-visible:shadow-dd-focus">{url}<span className="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span></a></div>
    <div className="flex shrink-0 flex-col items-end gap-2">
      <CopyButton value={url} />
      <CopyInstructionButton skillUrl={url} baseUrl={baseUrl} keyId={keyId} label="Copy for agent" />
    </div>
  </article>;
}

export default function SkillsPage() {
  const seed = getSkillRawUrl("durindoor");
  const { endpoints, keys, loading } = useSkillTargets();
  const [endpoint, setEndpoint] = useState("");
  const [keyId, setKeyId] = useState(NO_KEY);

  const baseUrl = endpoint || endpoints[0]?.value || "";
  const keyOptions = [
    { value: NO_KEY, label: "No key (Require API key off)" },
    ...keys.map((key) => ({ value: key.id, label: `${key.name} — ${key.maskedKey}` })),
  ];

  return <div className="mx-auto max-w-4xl space-y-4"><PageHeader icon="psychology" title="Skills" subtitle="Copy focused instructions into your AI workflow" />
    <Card padding={false}>
      <CardHeader icon="tune" title="Copy target" subtitle="Pick the endpoint and key your agent should use." />
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Endpoint">
          <Select options={endpoints} value={baseUrl} onChange={setEndpoint} className="font-mono" aria-label="Endpoint" disabled={loading} />
        </Field>
        <Field label="API key">
          <Select options={keyOptions} value={keyId} onChange={setKeyId} className="font-mono" aria-label="API key" disabled={loading} />
        </Field>
      </CardContent>
    </Card>
    <Card padding={false}><CardHeader icon="content_paste" title="Start with DurinDoor" subtitle="Paste this instruction into your AI" /><CardContent className="flex flex-wrap items-center gap-3"><code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text">{buildSkillInstruction({ skillUrl: seed, baseUrl, apiKey: keyId !== NO_KEY ? "sk-••••••••" : null })}</code><CopyInstructionButton skillUrl={seed} baseUrl={baseUrl} keyId={keyId} /></CardContent></Card>
    <section className="space-y-2" aria-label="Available skills">{SKILLS.map((skill) => <SkillRow key={skill.id} skill={skill} baseUrl={baseUrl} keyId={keyId} />)}</section>
    <Card padding={false}><CardHeader icon="open_in_new" title="More on GitHub" subtitle="Browse source, README, and examples." actions={<a href={`${SKILLS_REPO_URL}/tree/master/skills`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"><span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>View on GitHub</a>} /></Card>
  </div>;
}
