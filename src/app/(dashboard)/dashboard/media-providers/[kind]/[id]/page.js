"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import { AddCustomEmbeddingModal, NoAuthProxyCard, ProviderInfoCard } from "@/shared/components";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, isCustomEmbeddingProvider, isLocalOllamaProvider } from "@/shared/constants/providers";
import ConnectionsCard from "@/app/(dashboard)/dashboard/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard";
import { KIND_EXAMPLE_CONFIG } from "./components/exampleShared";
import { EmbeddingExampleCard } from "./components/EmbeddingExampleCard";
import { TtsExampleCard } from "./components/TtsExampleCard";
import { GenericExampleCard } from "./components/GenericExampleCard";
import { SttExampleCard } from "./components/SttExampleCard";

// MediaProviderDetailPage
export default function MediaProviderDetailPage() {
  const { kind, id } = useParams();
  const router = useRouter();
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isCustom = isCustomEmbeddingProvider(id) && kind === "embedding";

  const handleDeleteCustom = async () => {
    setDeleteError("");
    try {
      const res = await fetch(`/api/provider-nodes/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push(`/dashboard/media-providers/${kind}`);
      } else {
        const error = await res.json().catch(() => ({}));
        setDeleteError(error?.error || "Failed to delete custom embedding node");
      }
    } catch (error) {
      setDeleteError(error.message || "Failed to delete custom embedding node");
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const [customNode, setCustomNode] = useState(null);
  const [customLoading, setCustomLoading] = useState(isCustom);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // Fetch custom node info from API for custom embedding nodes
  useEffect(() => {
    if (!isCustom) return;
    let cancelled = false;
    fetch("/api/provider-nodes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCustomNode((d.nodes || []).find((n) => n.id === id) || null);
        setCustomLoading(false);
      })
      .catch(() => { if (!cancelled) setCustomLoading(false); });
    return () => { cancelled = true; };
  }, [id, isCustom]);

  if (!kindConfig) return notFound();

  const builtInProvider = AI_PROVIDERS[id];

  const provider = isCustom
    ? (customNode ? { id, name: customNode.name || "Custom Embedding", textIcon: "CE" } : null)
    : builtInProvider;

  if (!isCustom && !builtInProvider) return notFound();
  if (isCustom && !customLoading && !customNode) return notFound();
  if (customLoading) {
    return <div className="py-12 text-center text-[13px] text-dd-muted">Loading...</div>;
  }

  const baseKinds = provider.serviceKinds ?? ["llm"];
  const localEmbeddingOverride = isLocalOllamaProvider(provider.id) && kind === "embedding";
  const kinds = isCustom
    ? ["embedding"]
    : (localEmbeddingOverride ? Array.from(new Set([...baseKinds, "embedding"])) : baseKinds);
  if (!isCustom && !kinds.includes(kind)) return notFound();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link href={`/dashboard/media-providers/${kind}`} className="inline-flex min-h-11 w-fit items-center gap-1 rounded-dd px-2 text-[13px] text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>{kindConfig.label}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <ProviderLogo provider={provider.id} fallbackText={provider.textIcon} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-dd-text">{provider.name}</h1>
              {!isCustom && provider.notice?.apiKeyUrl && <a href={provider.notice.apiKeyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-dd px-2 text-xs font-medium text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined text-[14px]">open_in_new</span>Get API Key</a>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {isCustom && <Badge tone="neutral" size="sm">Custom · {customNode?.prefix}</Badge>}
              {kinds.map((item) => <Badge key={item} tone={item === kind ? "accent" : "neutral"} size="sm">{item.toUpperCase()}</Badge>)}
            </div>
          </div>
          {isCustom && <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon="edit" onClick={() => setShowEditModal(true)}>Edit</Button><Button size="sm" variant="danger" icon="delete" onClick={() => setShowDeleteConfirm(true)}>Delete</Button></div>}
        </div>
      </header>
      {deleteError && <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">{deleteError}</p>}
      {!isCustom && provider.kindNotice?.[kind] && <div role="note" className="flex items-start gap-3 rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-4 py-3 text-[13px] text-dd-warning"><span aria-hidden="true" className="material-symbols-outlined text-[18px]">warning</span><p>{provider.kindNotice[kind]}</p></div>}
      {!isCustom && provider.notice?.text && !provider.deprecated && <div role="note" className="flex flex-col gap-2 rounded-dd border border-dd-info/30 bg-dd-info/10 px-4 py-3 text-[13px] text-dd-info sm:flex-row sm:items-center"><span aria-hidden="true" className="material-symbols-outlined text-[18px]">info</span><p className="min-w-0 flex-1">{provider.notice.text}</p>{provider.notice.apiKeyUrl && <a href={provider.notice.apiKeyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center rounded-dd px-2 text-xs font-medium underline outline-none focus-visible:shadow-dd-focus">Get API Key</a>}</div>}

      {/* Connections */}
      {!isCustom && provider.noAuth ? (
        <NoAuthProxyCard providerId={id} />
      ) : (
        <ConnectionsCard providerId={id} isOAuth={false} />
      )}

      {/* Models - hidden for tts/webSearch/webFetch (provider IS the model); custom uses prefix as alias */}
      {kind !== "tts" && kind !== "webSearch" && kind !== "webFetch" && (
        <ModelsCard
          providerId={id}
          kindFilter={kind}
          providerAliasOverride={isCustom ? customNode?.prefix : undefined}
        />
      )}

      {/* Provider Info — config-driven, supports searchConfig, fetchConfig, ttsConfig, embeddingConfig, searchViaChat */}
      {!isCustom && (provider.searchConfig || provider.fetchConfig || provider.ttsConfig || provider.sttConfig || provider.embeddingConfig || provider.searchViaChat) && (
        <ProviderInfoCard
          config={
            kind === "webFetch" ? provider.fetchConfig
              : kind === "tts" ? provider.ttsConfig
              : kind === "stt" ? provider.sttConfig
              : kind === "embedding" ? provider.embeddingConfig
              : provider.searchConfig || { mode: "chat-completions", defaultModel: provider.searchViaChat?.defaultModel, pricingUrl: provider.searchViaChat?.pricingUrl, freeTier: provider.searchViaChat?.freeTier }
          }
          provider={provider}
          title={`${kindConfig.label} Config`}
        />
      )}

      {/* Example — per kind */}
      {kind === "embedding" && (
        <EmbeddingExampleCard providerId={id} customAlias={customNode?.prefix} />
      )}
      {kind === "tts" && <TtsExampleCard providerId={id} />}
      {kind === "stt" && !isCustom && <SttExampleCard providerId={id} />}
      {!isCustom && KIND_EXAMPLE_CONFIG[kind] && <GenericExampleCard providerId={id} kind={kind} />}

      {isCustom && <AddCustomEmbeddingModal isOpen={showEditModal} node={customNode} onClose={() => setShowEditModal(false)} onSaved={(updated) => { setCustomNode(updated); setShowEditModal(false); }} />}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete custom embedding node?"
        message="This removes the custom embedding node and cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={handleDeleteCustom}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
