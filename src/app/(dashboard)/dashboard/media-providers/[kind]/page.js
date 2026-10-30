"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { requestCollection, updateProviderConnections } from "../../providers/workflowRequests.js";
import Link from "next/link";
import Button from "@/shared/ui/components/Button.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import { AddCustomEmbeddingModal, AddSystemoneCompatibleModal } from "@/shared/components";
import { MEDIA_PROVIDER_KINDS, getProvidersByKind } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";
import { MediaProviderCard } from "../components/MediaProviderCard";
import { getLocalEmbeddingProviders } from "./localEmbeddingResolver";

// Kinds that support combos (currently disabled for image/tts — temporarily hidden).
// webSearch/webFetch handled by /web page.
import { isString } from "../../../../../shared/utils/typeChecks.js";
const COMBO_KINDS = new Set([]);
const COMBO_BASE_NAMES = { image: "image-combo", tts: "tts-combo" };

function ComboList({ combos }) {
  if (combos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {combos.map((combo) => (
        <Link key={combo.id} href={`/dashboard/media-providers/combo/${combo.id}`} className="rounded-dd-lg outline-none focus-visible:shadow-dd-focus">
          <Card hover className="flex min-w-0 items-center gap-3 p-3">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-accent">layers</span>
            <code className="min-w-0 flex-1 truncate text-[13px] font-medium text-dd-text">{combo.name}</code>
            <div role="group" className="flex flex-wrap items-center gap-1" aria-label={`${combo.models.length} providers`}>
              {combo.models.slice(0, 6).map((entry, index) => {
                const providerId = isString(entry) ? entry.split("/")[0] : "";
                return <ProviderLogo key={`${entry}-${index}`} provider={providerId} size={20} />;
              })}
              {combo.models.length > 6 && <span className="text-xs text-dd-muted">+{combo.models.length - 6}</span>}
            </div>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-subtle">chevron_right</span>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function MediaProviderKindPage() {
  const { kind } = useParams();
  const router = useRouter();
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggleError, setToggleError] = useState(null);
  const pending = useRef(new Set());
  const [saving, setSaving] = useState([]);
  const [connections, setConnections] = useState([]);
  const [customNodes, setCustomNodes] = useState([]);
  const [combos, setCombos] = useState([]);
  const [showAddCustomEmbedding, setShowAddCustomEmbedding] = useState(false);
  const [showAddSystemone, setShowAddSystemone] = useState(false);
  const [localEmbeddingProviders, setLocalEmbeddingProviders] = useState([]);
  const [createError, setCreateError] = useState("");
  // webSearch/webFetch listing pages are merged into /web
  useEffect(() => {
    if (kind === "webSearch" || kind === "webFetch") {
      router.replace("/dashboard/media-providers/web");
    }
  }, [kind, router]);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isEmbedding = kind === "embedding";
  const isSystemone = kind === "systemone";
  const supportsCombo = COMBO_KINDS.has(kind);

  const load = useCallback(async () => {
    if (!kindConfig) return;
    setLoading(true);
    try {
      const [items, nodes, models, loadedCombos] = await Promise.all([
        requestCollection("/api/providers", "connections"),
        isEmbedding || isSystemone ? requestCollection("/api/provider-nodes", "nodes") : [],
        isEmbedding ? requestCollection("/api/v1/models/embedding", "data") : [],
        supportsCombo ? requestCollection("/api/combos", "combos") : [],
      ]);
      setConnections(items);
      setCustomNodes(nodes.filter((node) => node.type === (isSystemone ? "systemone-compatible" : "custom-embedding")));
      setLocalEmbeddingProviders(isEmbedding ? getLocalEmbeddingProviders(models, items) : []);
      setCombos(loadedCombos); setLoadError(""); setToggleError(null); setLoaded(true);
    } catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }, [isEmbedding, isSystemone, supportsCombo, kindConfig]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  if (!kindConfig) return notFound();

  const providers = getProvidersByKind(kind);
  const kindCombos = combos.filter((c) => c.kind === kind);

  const customProviders = customNodes.map((n) => ({
    id: n.id,
    name: n.name || (isSystemone ? "Custom System One" : "Custom Embedding"),
    textIcon: isSystemone ? "S1" : "CE"
  }));

  const discoveredProviders = localEmbeddingProviders.filter((provider) => !providers.some((listed) => listed.id === provider.id));
  const allProviders = [...providers, ...(isEmbedding ? [...discoveredProviders, ...customProviders] : isSystemone ? customProviders : [])];

  const handleToggleProvider = async (providerId, newActive) => {
    if (pending.current.has(providerId)) return;
    pending.current.add(providerId); setSaving([...pending.current]);
    try {
      const providerConns = connections.filter((c) => c.provider === providerId);
      const { accepted, failed } = await updateProviderConnections(providerConns, newActive);
      setConnections((prev) => prev.map((c) => accepted.includes(c.id) ? { ...c, isActive: newActive } : c));
      setToggleError(failed.length ? { message: `${failed.length} connections could not be ${newActive ? "enabled" : "disabled"}. Previous state retained.`, retry: () => handleToggleProvider(providerId, newActive) } : null);
      try { setConnections(await requestCollection("/api/providers", "connections")); }
      catch (error) { setToggleError({ message: `Connection state could not be verified after the write. ${error.message}`, retry: load }); }
    } finally { pending.current.delete(providerId); setSaving([...pending.current]); }
  };

  const handleCreateCombo = async () => {
    const base = COMBO_BASE_NAMES[kind] || `${kind}-combo`;
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

  if (!loaded && loadError) return <div role="alert"><p>Provider configuration could not be loaded. {loadError}</p><Button icon="refresh" onClick={load}>Retry</Button></div>;
  if (!loaded && loading) return <p role="status">Loading provider configuration…</p>;
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {loadError && <div role="alert">Showing last confirmed configuration. {loadError}<Button icon="refresh" onClick={load}>Retry</Button></div>}
      {toggleError && <div role="alert">{toggleError.message}<Button icon="refresh" onClick={toggleError.retry}>Retry</Button></div>}
      {createError && <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">{createError}</p>}
      {(isEmbedding || isSystemone || supportsCombo) && (
        <div className="flex flex-wrap justify-end gap-2">
          {supportsCombo && <Button size="sm" variant="primary" icon="add" onClick={handleCreateCombo}>{translate("Create Combo")}</Button>}
          {isEmbedding && <Button size="sm" variant="primary" icon="add" onClick={() => setShowAddCustomEmbedding(true)}>{translate("Add Custom Embedding")}</Button>}
          {isSystemone && <Button size="sm" variant="primary" icon="add" onClick={() => setShowAddSystemone(true)}>Add Custom System One</Button>}
        </div>
      )}
      {supportsCombo && kindCombos.length > 0 && <ComboList combos={kindCombos} />}
      {allProviders.length === 0 ? (
        <EmptyState icon="deployed_code" title={`No ${kindConfig.label} providers`} message={`No providers support ${kindConfig.label} yet.`} />
      ) : (
        <section aria-label={`${kindConfig.label} providers`} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {providers.map((provider) => <MediaProviderCard key={provider.id} provider={provider} kind={kind} connections={connections} onToggle={handleToggleProvider} saving={saving.includes(provider.id)} />)}
          {isEmbedding && discoveredProviders.map((provider) => <MediaProviderCard key={provider.id} provider={provider} kind={kind} connections={connections} onToggle={handleToggleProvider} saving={saving.includes(provider.id)} />)}
          {(isEmbedding || isSystemone) && customProviders.map((provider) => <MediaProviderCard key={provider.id} provider={provider} kind={kind} connections={connections} isCustom onToggle={handleToggleProvider} saving={saving.includes(provider.id)} />)}
        </section>
      )}
      {isEmbedding && <AddCustomEmbeddingModal isOpen={showAddCustomEmbedding} onClose={() => setShowAddCustomEmbedding(false)} onCreated={(node) => { setCustomNodes((prev) => [...prev, node]); setShowAddCustomEmbedding(false); }} />}
      {isSystemone && <AddSystemoneCompatibleModal isOpen={showAddSystemone} onClose={() => setShowAddSystemone(false)} onCreated={(node) => { setCustomNodes((prev) => [...prev, node]); setShowAddSystemone(false); }} />}
    </div>
  );

}