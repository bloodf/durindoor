import React, { useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardHeader } from "@/shared/ui/components/Card.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import KeyValue from "@/shared/ui/components/KeyValue.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

import { apiKeys as defaultApiKeys, cloudflareEndpoints, endpointRows } from "./mockData.js";

function copyText(value) {
  navigator.clipboard?.writeText(value);
}

function EndpointRow({ endpoint }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-5 py-3.5">
      <div className="flex w-36 shrink-0 items-center gap-2">
        <Badge size="sm">{endpoint.label}</Badge>
        {endpoint.scope ? (
          <Badge tone="info" size="sm">
            {endpoint.scope}
          </Badge>
        ) : null}
      </div>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-dd-text" title={endpoint.url}>
        {endpoint.url}
      </code>
      <IconButton
        icon="content_copy"
        label={`Copy ${endpoint.label} endpoint`}
        size="sm"
        onClick={() => copyText(endpoint.url)}
      />
    </div>
  );
}

function ApiEndpointCard() {
  return (
    <Card padding={false}>
      <CardHeader icon="link" title="API Endpoint" />
      <div className="divide-y divide-dd-border-subtle">
        {endpointRows.map((endpoint) => (
          <EndpointRow key={endpoint.id} endpoint={endpoint} />
        ))}
      </div>
      <div className="border-t border-dd-border-subtle bg-dd-surface-2">
        <div className="px-5 pb-1 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-dd-muted">
            All Cloudflare endpoints
          </h3>
        </div>
        <div className="divide-y divide-dd-border-subtle">
          {cloudflareEndpoints.map((endpoint) => (
            <EndpointRow key={endpoint.id} endpoint={endpoint} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function ApiKeyRow({ apiKey, enabled, onEnabledChange }) {
  const meta = [
    { icon: "calendar_today", label: "Created", value: apiKey.created },
    { icon: "event_busy", label: "Expiry", value: apiKey.expiry },
    { icon: "deployed_code", label: "Models", value: apiKey.models },
    { icon: "token", label: "Usage", value: apiKey.usage, mono: true },
    { icon: "speed", label: "Limit", value: apiKey.dailyLimit },
  ];

  return (
    <div className="group flex items-center gap-4 px-5 py-4 hover:bg-dd-surface-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[13px] font-semibold text-dd-text">{apiKey.name}</h3>
          <Badge tone={enabled ? "success" : "neutral"} size="sm">
            {enabled ? "Active" : "Inactive"}
          </Badge>
          <code className="font-mono text-xs text-dd-muted">{apiKey.maskedKey}</code>
        </div>
        <div className="mt-2">
          <KeyValue items={meta} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <IconButton
            icon="content_copy"
            label={`Copy ${apiKey.name}`}
            size="sm"
            onClick={() => copyText(apiKey.maskedKey)}
          />
          <IconButton icon="edit" label={`Edit ${apiKey.name}`} size="sm" />
          <IconButton
            icon="delete"
            label={`Delete ${apiKey.name}`}
            size="sm"
            className="hover:bg-dd-danger/10 hover:text-dd-danger"
          />
        </div>
        <Toggle
          checked={enabled}
          onChange={onEnabledChange}
          size="sm"
          aria-label={`${enabled ? "Disable" : "Enable"} ${apiKey.name}`}
        />
      </div>
    </div>
  );
}

function ApiKeysCard({ apiKeys, totalKeyCount }) {
  const [requireKey, setRequireKey] = useState(true);
  const [enabledKeys, setEnabledKeys] = useState(() =>
    Object.fromEntries(apiKeys.map((apiKey) => [apiKey.id, apiKey.enabled])),
  );

  return (
    <Card padding={false}>
      <CardHeader
        icon="key"
        title="API Keys"
        actions={<Badge tone="neutral">{totalKeyCount}</Badge>}
      />
      <div className="border-b border-dd-border-subtle bg-dd-surface-2 px-5 py-4">
        <Toggle
          label="Require API key"
          description="Requests without a valid key will be rejected"
          checked={requireKey}
          onChange={setRequireKey}
        />
      </div>
      <div className="divide-y divide-dd-border-subtle">
        {apiKeys.map((apiKey) => (
          <ApiKeyRow
            key={apiKey.id}
            apiKey={apiKey}
            enabled={enabledKeys[apiKey.id]}
            onEnabledChange={(enabled) =>
              setEnabledKeys((current) => ({ ...current, [apiKey.id]: enabled }))
            }
          />
        ))}
      </div>
    </Card>
  );
}

/** Mocked endpoint and API-key configuration surface. */
export default function EndpointPage({ apiKeys = defaultApiKeys, totalKeyCount = 20 }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader icon="key" title="Endpoint" subtitle="API endpoint configuration" />

      <ApiEndpointCard />
      <ApiKeysCard apiKeys={apiKeys} totalKeyCount={totalKeyCount} />
    </div>
  );
}
