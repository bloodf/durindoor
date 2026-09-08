"use client";

import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Card } from "@/shared/ui/components/Card.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";

const STEPS = [
  { title: "Install DurinDoor", desc: "Run npx command to start the server instantly." },
  { title: "Open dashboard", desc: "Configure providers and API keys via web interface." },
  { title: "Route requests", desc: "Point your CLI tools to http://localhost:20128" },
];

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();
  const handleCopy = (text) => copy(text, "landing");
  const copyState = copied === "landing";

  return (
    <section className="bg-dd-bg-alt px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-start gap-16 lg:flex-row">
          <div className="flex-1">
            <h2 className="mb-6 text-3xl font-bold text-dd-text md:text-4xl">Get started in 30 seconds</h2>
            <p className="mb-8 text-lg text-dd-muted">Install DurinDoor, configure your providers via the web dashboard, and start routing AI requests.</p>
            <ol className="flex flex-col gap-6">
              {STEPS.map((step, idx) => <li key={step.title} className="flex gap-4"><span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dd-accent-soft text-sm font-bold text-dd-accent">{idx + 1}</span><div><h4 className="text-lg font-bold text-dd-text">{step.title}</h4><p className="mt-1 text-[13px] text-dd-muted">{step.desc}</p></div></li>)}
            </ol>
          </div>
          <div className="w-full flex-1">
            <Card padding={false} className="overflow-hidden bg-dd-surface text-[13px]">
              <div className="flex items-center gap-2 border-b border-dd-border bg-dd-surface-2 px-4 py-3"><span aria-hidden="true" className="size-3 rounded-full bg-dd-danger/80" /><span aria-hidden="true" className="size-3 rounded-full bg-dd-warning/80" /><span aria-hidden="true" className="size-3 rounded-full bg-dd-success/80" /><span className="ms-2 font-mono text-xs text-dd-muted">terminal</span></div>
              <div className="space-y-4 p-6 font-mono text-[13px] leading-relaxed">
                <div className="flex w-full items-center gap-2"><span className="text-dd-success">$</span><span className="text-dd-text">npx durindoor</span><IconButton icon={copyState ? "check" : "content_copy"} label={copyState ? "Command copied" : "Copy install command"} size="sm" variant="secondary" className="ms-auto" onClick={() => handleCopy("npx durindoor")} /></div>
                <div className="space-y-1 text-dd-muted"><p><span className="text-dd-accent">&gt;</span> Starting DurinDoor…</p><p><span className="text-dd-accent">&gt;</span> Server running on <span className="text-dd-info">http://localhost:20128</span></p><p><span className="text-dd-accent">&gt;</span> Dashboard: <span className="text-dd-info">http://localhost:20128/dashboard</span></p><p className="flex items-center gap-2"><StatusDot tone="success" pulse label="Ready" /><span className="text-dd-success">&gt;</span> Ready to route!</p></div>
                <p className="border-t border-dd-border pt-4 text-xs text-dd-muted">Configure providers in the dashboard or use environment variables.</p>
                <div className="text-xs text-dd-muted"><span className="text-dd-accent-2">Data location:</span><br /><span className="text-dd-subtle">macOS/Linux:</span> ~/.9router/db/data.sqlite (DurinDoor data directory)<br /><span className="text-dd-subtle">Windows:</span> %APPDATA%/9router/db/data.sqlite (DurinDoor data directory)</div>
              </div>
            </Card>
            <p className="mt-4 text-xs text-dd-subtle">Need a head start?{" "}<a href="https://github.com/bloodf/durindoor#readme" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-dd px-2.5 text-[13px] font-medium text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">arrow_forward</span>Read the docs</a></p>
          </div>
        </div>
      </div>
    </section>
  );
}
