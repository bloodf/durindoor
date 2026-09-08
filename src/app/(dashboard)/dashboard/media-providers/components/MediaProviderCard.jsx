"use client";

import Link from "next/link";
import { Card } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import { AI_PROVIDERS } from "@/shared/constants/providers";

function getEffectiveStatus(conn) {
  const isCooldown = Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
  );
  return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
}

export function MediaProviderCard({ provider, kind, connections, isCustom, onToggle }) {
  const providerInfo = AI_PROVIDERS[provider.id];
  const isNoAuth = !!providerInfo?.noAuth;

  const providerConns = connections.filter((c) => c.provider === provider.id);
  const connected = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "active" || s === "success"; }).length;
  const error = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "error" || s === "expired" || s === "unavailable"; }).length;
  const total = providerConns.length;
  const allDisabled = total > 0 && providerConns.every((c) => c.isActive === false);

  const renderStatus = () => {
    if (isNoAuth) return <Badge tone="success" size="sm">Ready</Badge>;
    if (allDisabled) return <Badge tone="neutral" size="sm">Disabled</Badge>;
    if (total === 0) return <span className="text-xs text-dd-muted">No connections</span>;
    return (
      <>
        {connected > 0 && <Badge tone="success" size="sm" icon="check_circle">{connected} Connected</Badge>}
        {error > 0 && <Badge tone="danger" size="sm" icon="error">{error} Error</Badge>}
        {connected === 0 && error === 0 && <Badge tone="neutral" size="sm">{total} Added</Badge>}
      </>
    );
  };

  return (
    <Card hover className={`h-full p-4 ${allDisabled ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Link
          href={`/dashboard/media-providers/${kind}/${provider.id}`}
          className="flex min-h-11 min-w-11 flex-1 items-center gap-3 rounded-dd outline-none focus-visible:shadow-dd-focus"
          aria-label={`Open ${provider.name}`}
        >
          <ProviderLogo provider={provider.id} fallbackText={provider.textIcon} size={32} className="shrink-0" />
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-dd-text">{provider.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {isCustom && <Badge tone="neutral" size="sm">Custom</Badge>}
              {renderStatus()}
            </div>
          </div>
        </Link>
        {total > 0 && (
          <Toggle
            size="sm"
            checked={!allDisabled}
            onChange={() => onToggle && onToggle(provider.id, allDisabled)}
            aria-label={allDisabled ? `Enable ${provider.name}` : `Disable ${provider.name}`}
          />
        )}
      </div>
    </Card>
  );
}

export default MediaProviderCard;
