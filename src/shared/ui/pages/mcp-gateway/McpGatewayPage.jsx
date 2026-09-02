import React, { useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";

import { mcpInstances } from "./mockData.js";

function InstanceAction({ label, icon, danger = false }) {
  return (
    <Tooltip content={label} side="top">
      <Button
        variant="ghost"
        size="sm"
        icon={icon}
        aria-label={label}
        className={danger ? "px-2 text-dd-danger hover:text-dd-danger" : "px-2"}
      />
    </Tooltip>
  );
}

function InstanceRow({ instance }) {
  const [enabled, setEnabled] = useState(instance.enabled);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none">
            hub
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-dd-text">{instance.title}</h3>
            <Badge size="sm">{instance.kind}</Badge>
            <Badge size="sm">{instance.transport}</Badge>
            <Badge tone="info" size="sm" icon="lock">
              {instance.auth}
            </Badge>
            <StatusDot tone="success" label={instance.status} />
            <Badge tone="success" size="sm">
              Enabled
            </Badge>
          </div>
          <p className="mt-1 text-xs text-dd-muted">
            <span className="font-mono text-dd-text">{instance.slug}</span>
            <span aria-hidden="true" className="px-2 text-dd-subtle">
              ·
            </span>
            <span className="font-mono">{instance.url}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-dd-border-subtle pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          size="sm"
          aria-label={`${enabled ? "Disable" : "Enable"} ${instance.title}`}
        />
        <InstanceAction label="Test" icon="play_arrow" />
        <InstanceAction label="Re-login" icon="login" />
        <InstanceAction label="Edit" icon="edit" />
        <InstanceAction label="Delete" icon="delete" danger />
      </div>
    </div>
  );
}

export default function McpGatewayPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="hub"
        title="MCP Gateway"
        subtitle="Register upstream MCP servers and expose them through one endpoint. Tools appear as <slug>__<toolName>"
      />

      <Card padding={false}>
        <CardHeader icon="hub" title="Instances" subtitle="1 registered" />
        <CardContent>
          {mcpInstances.map((instance) => (
            <InstanceRow key={instance.id} instance={instance} />
          ))}
        </CardContent>
      </Card>

      <Card padding={false}>
        <CardHeader icon="vpn_key" title="Gateway Keys" />
        <EmptyState
          icon="key_off"
          title="No gateway keys"
          message={'No gateway keys yet. Click "New key" to mint one.'}
        />
      </Card>
    </div>
  );
}
