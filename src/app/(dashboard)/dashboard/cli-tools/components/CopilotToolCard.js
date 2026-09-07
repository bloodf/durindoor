"use client";

import { useState, useEffect, useRef } from "react";
import { ModelSelectModal, ManualConfigModal } from "@/shared/components";
import { Card } from "@/shared/ui/components/Card";
import Button from "@/shared/ui/components/Button";
import IconButton from "@/shared/ui/components/IconButton";
import { Badge } from "@/shared/ui/components/Badge";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

export default function CopilotToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [selectedModels, setSelectedModels] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const selectedModelsRef = useRef([]);

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

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

  // Pre-fill from existing config
  useEffect(() => {
    if (status?.config && Array.isArray(status.config) && selectedModels.length === 0) {
      const entry = status.config.find((e) => e.name === "9Router");
      if (entry?.models?.length > 0) {
        setSelectedModels(entry.models.map((m) => m.id));
      }
    }
  }, [status]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const saveModels = async (models) => {
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_durindoor" : selectedApiKey);
      await fetch("/api/cli-tools/copilot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models }),
      });
    } catch (error) {
      console.log("Error saving models:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status) return null;
    if (!status.has9Router) return "not_configured";
    const url = status.currentUrl || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const removeModel = (id) => setSelectedModels((prev) => prev.filter((m) => m !== id));

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/copilot-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ error: error.message });
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

      const res = await fetch("/api/cli-tools/copilot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models: selectedModels }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Settings applied! Reload VS Code." });
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
      const res = await fetch("/api/cli-tools/copilot-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModels([]);
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
    const effectiveBaseUrl = getEffectiveBaseUrl();
    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];

    return [{
      filename: "~/Library/Application Support/Code/User/chatLanguageModels.json",
      content: JSON.stringify([{
        name: "DurinDoor",
        vendor: "azure",
        apiKey: keyToUse,
        models: modelsToShow.map((id) => ({
          id, name: id,
          url: `${effectiveBaseUrl}/chat/completions#models.ai.azure.com`,
          toolCalling: true, vision: false,
          maxInputTokens: 128000, maxOutputTokens: 16000,
        })),
      }], null, 2),
    }];
  };

  return (
    <Card padding={false} className="overflow-hidden p-4">
      <button type="button" aria-expanded={isExpanded} className="w-full text-left outline-none focus-visible:shadow-dd-focus flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>

        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/copilot.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-dd-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <Badge tone="success" size="sm">Connected</Badge>}
              {configStatus === "not_configured" && <Badge tone="warning" size="sm">Not configured</Badge>}
              {configStatus === "other" && <Badge tone="info" size="sm">Other</Badge>}
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
              <span>Checking Copilot config...</span>
            </div>
          )}

          {!checking && (
            <>
              <div className="flex items-start gap-3 p-3 bg-dd-info/10 border border-dd-info/30 rounded-dd-lg">
                <span aria-hidden="true" className="material-symbols-outlined text-dd-info text-lg">info</span>
                <div className="text-xs text-dd-info">
                  <p className="font-medium">Writes to <code className="px-1 bg-dd-surface-2 bg-dd-surface-3 rounded-dd">chatLanguageModels.json</code></p>
                  <p className="mt-0.5 opacity-80">Reload VS Code after applying for changes to take effect.</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {/* Endpoint */}
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

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">API Key</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-dd-text text-right pt-1">Models</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-dd-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-dd-muted">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span key={model} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-dd text-xs bg-dd-surface-2 bg-dd-surface-2 text-dd-muted border border-transparent hover:border-dd-border">
                            {model}
                            <IconButton icon="close" label={`Remove model ${model}`} size="sm" onClick={(e) => { e.stopPropagation(); removeModel(model); }} className="ml-0.5 hover:text-dd-danger" />
                          </span>
                        ))
                      )}
                    </div>
                    <div>
                      <Button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`px-2 py-1 rounded-dd border text-xs transition-colors ${activeProviders?.length ? "bg-dd-surface border-dd-border text-dd-text hover:border-dd-accent cursor-pointer" : "opacity-50 cursor-not-allowed border-dd-border"}`}>Add Model</Button>
                    </div>
                  </div>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs ${message.type === "success" ? "bg-dd-success/10 text-dd-success" : "bg-dd-danger/10 text-dd-danger"}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="secondary" size="sm" onClick={handleReset} disabled={!status?.has9Router} loading={restoring}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} disabled={selectedModels.length === 0}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          saveModels(selectedModelsRef.current);
        }}
        onSelect={(model) => {
          if (!selectedModels.includes(model.value)) {
            setSelectedModels([...selectedModels, model.value]);
          }
        }}
        onDeselect={(model) => {
          setSelectedModels(selectedModels.filter(m => m !== model.value));
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={selectedModels}
        closeOnSelect={false}
        title="Add Model for GitHub Copilot"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="GitHub Copilot - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
