"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/shared/ui/components/Button.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";
import { isString } from "../../../../../shared/utils/typeChecks.js";

function getEffectiveStatus(conn) {
  const isCooldown = Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
  );
  return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
}

function ProviderCard({ provider, kind, connections }) {
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
    <Link href={`/dashboard/media-providers/${kind}/${provider.id}`} className="block rounded-dd-lg outline-none focus-visible:shadow-dd-focus">
      <Card hover className={`h-full p-4 ${allDisabled ? "opacity-50" : ""}`}>
        <div className="flex min-w-0 items-center gap-3">
          <ProviderLogo provider={provider.id} size={32} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[13px] font-semibold text-dd-text">{provider.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">{renderStatus()}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ComboList({ combos }) {
  if (combos.length === 0) return <p className="text-xs italic text-dd-muted">No combos yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {combos.map((combo) => (
        <Link key={combo.id} href={`/dashboard/media-providers/combo/${combo.id}`} className="rounded-dd-lg outline-none focus-visible:shadow-dd-focus">
          <Card hover className="flex min-w-0 items-center gap-3 p-3">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-accent">layers</span>
            <code className="min-w-0 flex-1 truncate text-[13px] font-medium text-dd-text">{combo.name}</code>
            <div className="flex flex-wrap items-center gap-1">
              {combo.models.slice(0, 6).map((entry, index) => {
                const providerId = isString(entry) ? entry.split("/")[0] : "";
                return <ProviderLogo key={`${entry}-${index}`} provider={providerId} size={20} />;
              })}
              {combo.models.length > 6 && <span className="text-xs text-dd-muted">+{combo.models.length - 6}</span>}
            </div>
            <span className="shrink-0 text-xs text-dd-muted">{combo.models.length}</span>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-subtle">chevron_right</span>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function Section({ title, icon, kind, providers, connections, combos, onCreateCombo }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-accent">{icon}</span>
          <h2 className="text-base font-semibold text-dd-text">{title}</h2>
          <span className="text-xs text-dd-muted">({providers.length} providers · {combos.length} combos)</span>
        </div>
        <Button size="sm" variant="primary" icon="add" onClick={onCreateCombo}>Create Combo</Button>
      </div>
      {combos.length > 0 && <ComboList combos={combos} />}
      {providers.length === 0 ? (
        <EmptyState icon={icon} title="No providers" message={`No ${title.toLowerCase()} providers yet.`} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {providers.map((p) => <ProviderCard key={p.id} provider={p} kind={kind} connections={connections} />)}
        </div>
      )}
    </section>
  );
}

export default function WebProvidersPage() {
  const router = useRouter();
  const [connections, setConnections] = useState([]);
  const [combos, setCombos] = useState([]);
  const [createError, setCreateError] = useState("");

  const fetchAll = async () => {
    try {
      const [connsRes, combosRes] = await Promise.all([
      fetch("/api/providers", { cache: "no-store" }),
      fetch("/api/combos", { cache: "no-store" })]
      );
      if (connsRes.ok) setConnections((await connsRes.json()).connections || []);
      if (combosRes.ok) setCombos((await combosRes.json()).combos || []);
    } catch {/* noop */}
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {fetchAll();}, []);

  const searchProviders = getProvidersByKind("webSearch");
  const fetchProviders = getProvidersByKind("webFetch");
  const searchCombos = combos.filter((c) => c.kind === "webSearch");
  const fetchCombos = combos.filter((c) => c.kind === "webFetch");

  const handleCreateCombo = async (kind) => {
    // Generate unique default name
    const base = kind === "webSearch" ? "search-combo" : "fetch-combo";
    let name = base;
    let i = 1;
    const existing = new Set(combos.map((c) => c.name));
    while (existing.has(name)) {name = `${base}-${i++}`;}
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, models: [], kind })
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/dashboard/media-providers/combo/${created.id}`);
    } else {
      const err = await res.json().catch(() => ({}));
      setCreateError(err?.error || "Failed to create combo");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      {createError && <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">{createError}</p>}
      <Section title="Web Search" icon="search" kind="webSearch" providers={searchProviders} connections={connections} combos={searchCombos} onCreateCombo={() => handleCreateCombo("webSearch")} />
      <hr className="border-t border-dd-border-subtle" />
      <Section title="Web Fetch" icon="travel_explore" kind="webFetch" providers={fetchProviders} connections={connections} combos={fetchCombos} onCreateCombo={() => handleCreateCombo("webFetch")} />
    </div>
  );
}