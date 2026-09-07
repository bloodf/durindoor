"use client";

import { useState, useEffect } from "react";
import { ModelSelectModal, ManualConfigModal } from "@/shared/components";
import { Card } from "@/shared/ui/components/Card";
import Button from "@/shared/ui/components/Button";
import IconButton from "@/shared/ui/components/IconButton";
import { Badge } from "@/shared/ui/components/Badge";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

export default function KiloToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
      checkStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    return status.has9Router ? "configured" : "not_configured";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/kilo-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_durindoor" : selectedApiKey);

      const res = await fetch("/api/cli-tools/kilo-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, model: selectedModel }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/kilo-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_durindoor" : "<API_KEY_FROM_DASHBOARD>");

    return [{
      filename: "~/.local/share/kilo/auth.json",
      content: JSON.stringify({
        "openai-compatible": {
          type: "api-key",
          apiKey: keyToUse,
          baseUrl: getEffectiveBaseUrl(),
          model: selectedModel || "provider/model-id",
        },
      }, null, 2),
    }];
  };

  return (
    <Card padding={false} className="overflow-hidden p-4">
      <button type="button" aria-expanded={isExpanded} className="w-full text-left outline-none focus-visible:shadow-dd-focus flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>

        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/kilocode.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-dd-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <Badge tone="success" size="sm">Connected</Badge>}
              {configStatus === "not_configured" && <Badge tone="warning" size="sm">Not configured</Badge>}
            </div>
            <p className="text-xs text-dd-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span aria-hidden="true" className={`material-symbols-outlined text-dd-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-dd-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-dd-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Kilo Code...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-dd-warning/10 border border-dd-warning/30 rounded-dd-lg">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="material-symbols-outlined text-dd-warning">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-dd-warning">Kilo Code not detected locally</p>
                    <p className="text-sm text-dd-muted">Manual configuration is still available if DurinDoor is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-dd-surface !border-dd-warning/40 !text-dd-warning">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-dd-surface border border-dd-border rounded-dd-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <p className="text-sm text-dd-muted">Install Kilo Code from <a className="text-dd-accent underline" href="https://kilocode.ai" target="_blank" rel="noreferrer">kilocode.ai</a> or VS Code extension marketplace.</p>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Select Endpoint</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">API Key</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Model</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="relative w-full min-w-0">
                    <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-12 py-2 bg-dd-surface rounded-dd border border-dd-border text-xs focus:outline-none focus:ring-1 focus-visible:shadow-dd-focus sm:py-1.5" />
                    {selectedModel && <IconButton icon="close" label="Clear model" size="sm" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 text-dd-muted hover:text-dd-danger" />}
                  </div>
                  <Button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`w-full sm:w-auto rounded-dd border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-dd-surface border-dd-border text-dd-text hover:border-dd-accent cursor-pointer" : "opacity-50 cursor-not-allowed border-dd-border"}`}>Select Model</Button>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs ${message.type === "success" ? "bg-dd-success/10 text-dd-success" : "bg-dd-danger/10 text-dd-danger"}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={(!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !selectedModel} loading={applying}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="secondary" size="sm" onClick={handleReset} disabled={restoring} loading={restoring}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(model) => { setSelectedModel(model.value); setModalOpen(false); }}
        selectedModel={selectedModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Kilo Code"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Kilo Code - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
