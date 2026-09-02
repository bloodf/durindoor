import React, { useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

import { LEVEL_OPTIONS, PXPIPE_DEFAULTS, RECENTLY_BLOCKED_MODELS } from "./mockData.js";

function SettingRow({ title, description, status, children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-dd-border-subtle py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-medium text-dd-text">{title}</h3>
          {status}
        </div>
        <p className="mt-1 text-xs leading-5 text-dd-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage({
  initialRtk = true,
  initialHeadroom = true,
  initialCaveman = "full",
  initialPonytail = "full",
}) {
  const [rtk, setRtk] = useState(initialRtk);
  const [headroom, setHeadroom] = useState(initialHeadroom);
  const [caveman, setCaveman] = useState(initialCaveman);
  const [ponytail, setPonytail] = useState(initialPonytail);
  const [minChars, setMinChars] = useState(PXPIPE_DEFAULTS.minChars);
  const [timeout, setTimeout] = useState(PXPIPE_DEFAULTS.timeout);
  const [allowedModels, setAllowedModels] = useState(PXPIPE_DEFAULTS.allowedModels);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        icon="compress"
        title="Token Saver"
        subtitle="Compress prompts and outputs to save tokens"
      />

      <Card padding={false}>
        <CardHeader
          icon="compress"
          title="Token Saver"
          subtitle="Choose how aggressively DurinDoor reduces request and response tokens."
        />
        <CardContent className="py-0">
          <SettingRow
            title="Compress tool output (RTK)"
            description="git/grep/ls/tree/logs → 60-90% fewer input tokens"
            status={<StatusDot tone="success" pulse label="Active" />}
          >
            <Toggle
              checked={rtk}
              onChange={setRtk}
              aria-label="Compress tool output with RTK"
            />
          </SettingRow>
          <SettingRow
            title="Compress context (Headroom)"
            description="Condense oversized context before it reaches the selected model."
            status={<Badge tone="success" size="sm">Running</Badge>}
          >
            <div className="flex items-center gap-3">
              <a
                href="#headroom"
                className="text-xs font-medium text-dd-accent hover:text-dd-accent-hover"
              >
                Open full page →
              </a>
              <Toggle
                checked={headroom}
                onChange={setHeadroom}
                aria-label="Compress context with Headroom"
              />
            </div>
          </SettingRow>
          <SettingRow
            title="Compress LLM output (Caveman)"
            description="Shorten model prose while preserving technical detail and code."
          >
            <SegmentedControl
              options={LEVEL_OPTIONS}
              value={caveman}
              onChange={setCaveman}
              size="sm"
              aria-label="Caveman compression level"
            />
          </SettingRow>
          <SettingRow
            title="Lazy senior dev (Ponytail)"
            description="Prefer the smallest maintainable implementation that solves the request."
          >
            <SegmentedControl
              options={LEVEL_OPTIONS}
              value={ponytail}
              onChange={setPonytail}
              size="sm"
              aria-label="Ponytail level"
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card padding={false}>
        <CardHeader
          icon="filter_alt"
          title="PXPipe"
          subtitle="Skip compression for short requests and incompatible models."
          actions={<Badge tone="success" icon="check_circle">Running · v0.9.0</Badge>}
        />
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Min chars"
              size="sm"
              value={minChars}
              onChange={(event) => setMinChars(event.target.value)}
              className="dd-tnum font-mono"
              inputMode="numeric"
            />
            <Input
              label="Timeout (ms)"
              size="sm"
              value={timeout}
              onChange={(event) => setTimeout(event.target.value)}
              className="dd-tnum font-mono"
              inputMode="numeric"
            />
          </div>
          <Textarea
            label="Allowed models"
            hint="One provider/model pattern per line."
            rows={4}
            value={allowedModels}
            onChange={(event) => setAllowedModels(event.target.value)}
            className="font-mono"
          />
          <div>
            <p className="mb-2 text-xs font-medium text-dd-muted">Recently blocked</p>
            <div className="flex flex-wrap gap-2">
              {RECENTLY_BLOCKED_MODELS.map((model) => (
                <Chip key={model} label={model} size="sm" icon="block" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
