"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge, Button, AddCustomEmbeddingModal } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";
import { MediaProviderCard } from "../components/MediaProviderCard";
import { getLocalEmbeddingProviders } from "./localEmbeddingResolver";

// Kinds that support combos (currently disabled for image/tts — temporarily hidden).
// webSearch/webFetch handled by /web page.
const COMBO_KINDS = new Set([]);
const COMBO_BASE_NAMES = { image: "image-combo", tts: "tts-combo" };

function ComboList({ combos }) {
  if (combos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {combos.map((combo) => (
        <Link key={combo.id} href={`/dashboard/media-providers/combo/${combo.id}`}>
          <Card padding="xs" className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
            <div className="flex min-w-0 items-center gap-3">
              <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
              <code className="text-sm font-mono font-medium flex-1 truncate">{combo.name}</code>
              <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
                {combo.models.slice(0, 6).map((entry, i) => {
                  const pid = typeof entry === "string" ? entry.split("/")[0] : "";
                  const p = AI_PROVIDERS[pid];
                  return (
                    <div key={`${entry}-${i}`} title={p?.name || entry} className="size-5 rounded flex items-center justify-center" style={{ backgroundColor: `${(p?.color ?? "#888")}15` }}>
                      <ProviderIcon
                        src={`/providers/${pid}.png`}
                        alt={p?.name || pid}
                        size={18}
                        className="object-contain rounded max-w-[18px] max-h-[18px]"
                        fallbackText={p?.textIcon || pid.slice(0, 2).toUpperCase()}
                        fallbackColor={p?.color}
                      />
                    </div>
                  );
                })}
                {combo.models.length > 6 && (
                  <span className="text-[10px] text-text-muted ml-1">+{combo.models.length - 6}</span>
                )}
              </div>
              <span className="text-[11px] text-text-muted shrink-0">{combo.models.length}</span>
              <span className="material-symbols-outlined text-text-muted text-[16px]">chevron_right</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function MediaProviderKindPage() {
  const { kind } = useParams();
  const router = useRouter();
  const [connections, setConnections] = useState([]);
  const [customNodes, setCustomNodes] = useState([]);
  const [combos, setCombos] = useState([]);
  const [showAddCustomEmbedding, setShowAddCustomEmbedding] = useState(false);
  const [localEmbeddingProviders, setLocalEmbeddingProviders] = useState([]);

  // webSearch/webFetch listing pages are merged into /web
  useEffect(() => {
    if (kind === "webSearch" || kind === "webFetch") {
      router.replace("/dashboard/media-providers/web");
    }
  }, [kind, router]);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isEmbedding = kind === "embedding";
  const supportsCombo = COMBO_KINDS.has(kind);

  useEffect(() => {
    if (!kindConfig) return;
    let cancelled = false;
    let fetchedConnections = [];

    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        fetchedConnections = d.connections || [];
        setConnections(fetchedConnections);
      })
      .catch(() => {})
      .then(() => {
        if (!isEmbedding || cancelled) return;
        fetch("/api/v1/models/embedding", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { data: [] }))
          .then((d) => {
            if (cancelled) return;
            setLocalEmbeddingProviders(getLocalEmbeddingProviders(d.data, fetchedConnections));
          })
          .catch(() => { if (!cancelled) setLocalEmbeddingProviders([]); });
      });

    if (isEmbedding) {
      fetch("/api/provider-nodes", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setCustomNodes((d.nodes || []).filter((n) => n.type === "custom-embedding")); })
        .catch(() => {});
    }
    if (supportsCombo) {
      fetch("/api/combos", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setCombos(d.combos || []); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [isEmbedding, supportsCombo, kindConfig]);

  if (!kindConfig) return notFound();

  const providers = getProvidersByKind(kind);
  const kindCombos = combos.filter((c) => c.kind === kind);

  // Map custom nodes to MediaProviderCard shape
  const customProviders = customNodes.map((n) => ({
    id: n.id,
    name: n.name || "Custom Embedding",
    color: "#6366F1",
    textIcon: "CE",
  }));

  const allProviders = [...providers, ...(isEmbedding ? [...localEmbeddingProviders, ...customProviders] : [])];

  const handleToggleProvider = async (providerId, newActive) => {
    const providerConns = connections.filter((c) => c.provider === providerId);
    setConnections((prev) =>
      prev.map((c) => (c.provider === providerId ? { ...c, isActive: newActive } : c))
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        })
      )
    );
  };

  const handleCreateCombo = async () => {
    const base = COMBO_BASE_NAMES[kind] || `${kind}-combo`;
    let name = base;
    let i = 1;
    const existing = new Set(combos.map((c) => c.name));
    while (existing.has(name)) { name = `${base}-${i++}`; }
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, models: [], kind }),
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/dashboard/media-providers/combo/${created.id}`);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create combo");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {(isEmbedding || supportsCombo) && (
        <div className="flex items-center justify-end gap-2">
          {supportsCombo && (
            <Button size="sm" icon="add" onClick={handleCreateCombo}>{translate("Create Combo")}</Button>
          )}
          {isEmbedding && (
            <Button size="sm" icon="add" onClick={() => setShowAddCustomEmbedding(true)}>
              {translate("Add Custom Embedding")}
            </Button>
          )}
        </div>
      )}

      {supportsCombo && kindCombos.length > 0 && (
        <ComboList combos={kindCombos} />
      )}

      {allProviders.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-text-muted text-sm">
          No providers support <strong>{kindConfig.label}</strong> yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {providers.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              onToggle={handleToggleProvider}
            />
          ))}
          {isEmbedding && localEmbeddingProviders.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              onToggle={handleToggleProvider}
            />
          ))}
          {isEmbedding && customProviders.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              isCustom
              onToggle={handleToggleProvider}
            />
          ))}
        </div>
      )}

      {isEmbedding && (
        <AddCustomEmbeddingModal
          isOpen={showAddCustomEmbedding}
          onClose={() => setShowAddCustomEmbedding(false)}
          onCreated={(node) => {
            setCustomNodes((prev) => [...prev, node]);
            setShowAddCustomEmbedding(false);
          }}
        />
      )}
    </div>
  );
}
