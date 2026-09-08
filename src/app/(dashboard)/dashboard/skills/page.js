"use client";

import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { SKILLS, SKILLS_REPO_URL, getSkillRawUrl, getSkillBlobUrl } from "@/shared/constants/skills";

function CopyButton({ value, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return <Button size="sm" variant="ghost" icon={copied ? "check" : "content_copy"} onClick={() => copy(value)} title={value}>{copied ? "Copied" : label}</Button>;
}

function SkillRow({ skill }) {
  const url = getSkillRawUrl(skill.id);
  return <article className="flex flex-col gap-3 rounded-dd-lg border border-dd-border-subtle bg-dd-surface p-4 sm:flex-row sm:items-start">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">{skill.icon}</span></span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-[13px] font-semibold text-dd-text">{skill.name}</h2>{skill.isEntry ? <Badge tone="accent">START HERE</Badge> : null}{skill.endpoint ? <Badge tone="neutral">{skill.endpoint}</Badge> : null}</div><p className="mt-1 text-xs text-dd-muted">{skill.description}</p><a href={getSkillBlobUrl(skill.id)} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 break-all text-xs text-dd-accent outline-none focus-visible:shadow-dd-focus">{url}<span className="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span></a></div>
    <CopyButton value={url} />
  </article>;
}

export default function SkillsPage() {
  const seed = getSkillRawUrl("durindoor");
  return <div className="mx-auto max-w-4xl space-y-4"><PageHeader icon="psychology" title="Skills" subtitle="Copy focused instructions into your AI workflow" />
    <Card padding={false}><CardHeader icon="content_paste" title="Start with DurinDoor" subtitle="Paste this instruction into your AI" /><CardContent className="flex flex-wrap items-center gap-3"><code className="min-w-0 flex-1 break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text">Read this skill and use it: {seed}</code><CopyButton value={`Read this skill and use it: ${seed}`} label="Copy instruction" /></CardContent></Card>
    <section className="space-y-2" aria-label="Available skills">{SKILLS.map((skill) => <SkillRow key={skill.id} skill={skill} />)}</section>
    <Card padding={false}><CardHeader icon="open_in_new" title="More on GitHub" subtitle="Browse source, README, and examples." actions={<a href={`${SKILLS_REPO_URL}/tree/master/skills`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-dd-accent outline-none focus-visible:shadow-dd-focus"><span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>View on GitHub</a>} /></Card>
  </div>;
}
