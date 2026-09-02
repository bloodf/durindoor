import { useMemo, useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";

import {
  ACCOUNT_OPTIONS,
  PROVIDER_OPTIONS,
  QUOTA_PROVIDERS,
  SORT_OPTIONS,
} from "./mockData.js";

function remainingTone(remainingPercent) {
  if (remainingPercent < 5) return "danger";
  if (remainingPercent < 20) return "warning";
  if (remainingPercent >= 50) return "success";
  return "warning";
}

const PROGRESS_TONES = {
  success: "bg-dd-success",
  warning: "bg-dd-warning",
  danger: "bg-dd-danger",
};

function ProgressBar({ percent, tone }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-dd-surface-3"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 rounded-full ${PROGRESS_TONES[tone]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function QuotaRow({ quota }) {
  const limit = quota.limit;
  const value = quota.used;
  const usedPercent = limit > 0 ? Math.min(100, Math.round((value / limit) * 100)) : 0;
  const remainingPercent = 100 - usedPercent;
  const tone = remainingTone(remainingPercent);
  const unit = quota.unit ?? "";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-dd-text">{quota.name}</span>
        <span className="dd-tnum font-mono text-[12px] text-dd-text">
          {value}
          {unit}
          <span className="text-dd-subtle">/{limit}{unit}</span>
        </span>
        <Badge tone={tone} size="sm">
          {remainingPercent}%
        </Badge>
      </div>
      <ProgressBar percent={remainingPercent} tone={tone} />
      <div className="flex items-center justify-between text-xs text-dd-subtle">
        <span>Resets {quota.expires}</span>
      </div>
    </div>
  );
}

/** Quota headers resolve branding from the provider ID with automatic fallback. */
function ProviderCard({ provider }) {
  const rateLimited = provider.state === "Rate limited";
  return (
    <article className="flex flex-col gap-4 rounded-dd-lg border border-dd-border bg-dd-surface p-5">
      <header className="flex items-start gap-3">
        <ProviderLogo provider={provider.id} size={32} className="m-1" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-dd-text">{provider.name}</span>
          <span className="truncate text-xs text-dd-muted">{provider.subtitle}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content="Burst priority" side="top">
            <IconButton icon="bolt" label="Burst priority" size="sm" variant="ghost" />
          </Tooltip>
          <Tooltip content="Refresh now" side="top">
            <IconButton icon="refresh" label="Refresh quota" size="sm" variant="ghost" />
          </Tooltip>
          <Tooltip content="Edit provider" side="top">
            <IconButton icon="edit" label="Edit provider" size="sm" variant="ghost" />
          </Tooltip>
          <Tooltip content="Delete provider" side="top">
            <IconButton icon="delete" label="Delete provider" size="sm" variant="ghost" />
          </Tooltip>
        </div>
      </header>
      {rateLimited ? (
        <div className="flex items-center justify-between rounded-dd border border-dd-border-subtle bg-dd-bg-alt px-3 py-2">
          <div className="flex items-center gap-2">
            <StatusDot tone="danger" pulse />
            <span className="text-[13px] font-medium text-dd-danger">Rate limited</span>
          </div>
          <span className="text-xs text-dd-subtle">{provider.detail}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {provider.quotas.map((quota) => (
            <QuotaRow key={quota.name} quota={quota} />
          ))}
        </div>
      )}
    </article>
  );
}

export default function QuotaPage({
  providers = QUOTA_PROVIDERS,
  autoRefresh = true,
  defaultProviderFilter = "all",
}) {
  const [providerFilter, setProviderFilter] = useState(defaultProviderFilter);
  const [accountFilter, setAccountFilter] = useState("all");
  const [sortBy, setSortBy] = useState("expiring");

  const visible = useMemo(() => {
    if (providerFilter === "all") return providers;
    return providers.filter((provider) => provider.id === providerFilter);
  }, [providers, providerFilter]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon="data_usage"
        title="Quota Tracker"
        subtitle="Track and manage your API quota limits"
      />

      <div className="flex flex-wrap items-end gap-3 rounded-dd-lg border border-dd-border bg-dd-surface px-4 py-3">
        <div className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-dd-subtle">Provider</span>
          <Select
            options={PROVIDER_OPTIONS}
            value={providerFilter}
            onChange={setProviderFilter}
            size="sm"
            aria-label="Filter by provider"
          />
        </div>
        <div className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-dd-subtle">Account</span>
          <Select
            options={ACCOUNT_OPTIONS}
            value={accountFilter}
            onChange={setAccountFilter}
            size="sm"
            aria-label="Filter by account"
          />
        </div>
        <div className="flex min-w-[10rem] flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-dd-subtle">Sort</span>
          <Select
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={setSortBy}
            size="sm"
            aria-label="Sort quotas"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Chip icon="visibility_off" label="Turn off Empty" size="md" onClick={() => undefined} />
          <Chip icon="check_circle" label="Turn on Available" size="md" onClick={() => undefined} />
          <Badge tone={autoRefresh ? "success" : "neutral"} icon="schedule" size="md">
            Auto-refresh {autoRefresh ? "30s" : "off"}
          </Badge>
          <IconButton icon="refresh" label="Refresh quotas" variant="secondary" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {visible.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
    </div>
  );
}
