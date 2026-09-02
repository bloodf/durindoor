import React from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

const cliTools = [
  { name: "Claude Code", provider: "claude", status: "Not configured" },
  { name: "Open Claw", provider: "open-claw", status: "Not installed" },
  { name: "OpenAI Codex CLI / App", provider: "codex", status: "Not configured" },
  { name: "OpenCode", provider: "opencode", status: "Not configured" },
  { name: "Claude Cowork", provider: "claude", status: "Not configured" },
  { name: "Hermes Agent", provider: "hermes", status: "Not configured" },
  { name: "Factory Droid", provider: "droid", status: "Not configured" },
  { name: "Cursor", provider: "cursor", status: "Unknown" },
  { name: "Cline", provider: "cline", status: "Not configured" },
  { name: "Kilo Code", provider: "kilocode", status: "Not configured" },
  { name: "Roo", provider: "roo", status: "Not configured" },
  { name: "Continue", provider: "continue", status: "Not configured" },
  { name: "Amp CLI", provider: "amp", status: "Unsupported" },
  { name: "Qwen Code", provider: "qwen", status: "Not configured" },
  { name: "DeepSeek TUI", provider: "deepseek-tui", status: "Not configured" },
  { name: "jcode", provider: "jcode", status: "Not configured" },
  { name: "Grok Build", provider: "grok-web", status: "Not configured" },
  { name: "Oh My Pi…", provider: "oh-my-pi", status: "Not configured" },
];

const mitmTools = [
  { name: "Antigravity MITM", provider: "antigravity", status: "Not configured" },
  { name: "GitHub Copilot MITM", provider: "copilot", status: "Not configured" },
  { name: "Kiro MITM", provider: "kiro", status: "Not configured" },
];

const statusTones = {
  "Not configured": "warning",
  "Not installed": "neutral",
  Unknown: "neutral",
  Unsupported: "danger",
};

function ToolCard({ tool }) {
  return (
    <Card hover className="flex min-w-0 items-center gap-3 p-4 hover:border-dd-accent">
      <ProviderLogo provider={tool.provider} size={32} className="m-1" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <h2 className="truncate text-[13px] font-semibold text-dd-text">{tool.name}</h2>
        <Badge tone={statusTones[tool.status]} size="sm">
          {tool.status}
        </Badge>
      </div>
      <IconButton icon="chevron_right" label={`Configure ${tool.name}`} size="sm" />
    </Card>
  );
}

function ToolGrid({ tools }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} />
      ))}
    </div>
  );
}

/** Mocked branded CLI integration catalog; shell-level page identity comes from its story. */
export default function CliToolsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <PageHeader icon="code" title="CLI Tools" subtitle="Configure CLI tools" />

      <section aria-label="CLI tools">
        <ToolGrid tools={cliTools} />
      </section>

      <section aria-labelledby="mitm-tools-title" className="flex flex-col gap-3">
        <div>
          <h2 id="mitm-tools-title" className="text-sm font-semibold text-dd-text">
            MITM Tools
          </h2>
          <p className="mt-0.5 text-xs text-dd-muted">Configure local traffic interception tools.</p>
        </div>
        <ToolGrid tools={mitmTools} />
      </section>
    </div>
  );
}
