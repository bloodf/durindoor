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
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { isString } from "@/shared/utils/typeChecks";

const DEFAULT_MODEL = "provider/model-id";

const INSTALL_COMMANDS = {
  pi: "curl -fsSL https://pi.dev/install.sh | sh  # or: npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
  crush: "brew install charmbracelet/tap/crush  # or: go install github.com/charmbracelet/crush@latest",
  forge: "cargo install forgecode",
  smelt: "cargo install smelt",
  codewhale: "cargo install codewhale",
};

// Pi takes a model list; the other tools take a single default model.
const isMultiModel = (toolId) => toolId === "pi";

const getDurinDoorProvider = (config) => config?.providers?.durindoor || config?.providers?.["9router"];

const getConfiguredModels = (config) =>
  (getDurinDoorProvider(config)?.models || []).map((m) => (isString(m) ? m : m?.id)).filter(Boolean);

const getConfiguredModel = (config) =>
  config?.model || config?.openai?.model || getConfiguredModels(config)[0] || "";

const getConfiguredBaseUrl = (config) => {
  const provider = getDurinDoorProvider(config);
  return config?.baseUrl || config?.openai?.base_url || provider?.base_url || provider?.baseUrl || "";
};

/**
 * Settings card shared by CLI tools whose config is one OpenAI-compatible endpoint
 * (Pi, Crush, ForgeCode, Smelt, CodeWhale). Talks to `/api/cli-tools/<toolId>-settings`.
 */
export default function GenericCliToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders = [],
  hasActiveProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(() => getConfiguredModel(initialStatus?.config));
  const [selectedModels, setSelectedModels] = useState(() => getConfiguredModels(initialStatus?.config));
  const [modalOpen, setModalOpen] = useState(false);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  const endpointUrl = `/api/cli-tools/${tool.id}-settings`;
  const multiModel = isMultiModel(tool.id);
  const canSelectModel = hasActiveProviders ?? activeProviders.length > 0;

  const syncModelsFromStatus = (data) => {
    const cfg = data?.config;
    if (multiModel) {
      const ids = getConfiguredModels(cfg);
      if (ids.length > 0) setSelectedModels(ids);
    } else {
      const configured = getConfiguredModel(cfg);
      if (configured) setSelectedModel((prev) => prev || configured);
    }
  };

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(endpointUrl);
      const data = await res.json();
      setStatus(data);
      syncModelsFromStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isExpanded && !status) checkStatus();
  }, [isExpanded]);

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const currentBaseUrl = getConfiguredBaseUrl(status?.config);

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.has9Router) return "not_configured";
    if (!currentBaseUrl || matchKnownEndpoint(currentBaseUrl, { tunnelPublicUrl, tailscaleUrl })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  const getKeyToUse = (fallback) => selectedApiKey?.trim() || (!cloudEnabled ? "sk_durindoor" : fallback);

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const payload = { baseUrl: getEffectiveBaseUrl(), apiKey: getKeyToUse(null) };
      if (multiModel) payload.models = selectedModels.length > 0 ? selectedModels : [DEFAULT_MODEL];
      else payload.model = selectedModel;

      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Settings applied successfully!" });
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
      const res = await fetch(endpointUrl, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Settings reset successfully!" });
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

  const handleSelectModel = (model) => {
    if (multiModel) setSelectedModels((prev) => (prev.includes(model.value) ? prev : [...prev, model.value]));
    else setSelectedModel(model.value);
    setModalOpen(false);
  };

  const handleAddAllActiveModels = () => {
    const all = activeProviders.flatMap((conn) => {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      return getModelsByProviderId(conn.provider).map((m) => `${alias}/${m.id}`);
    });
    if (all.length > 0) setSelectedModels((prev) => Array.from(new Set([...prev, ...all])));
  };

  const getManualConfigs = () => {
    const url = getEffectiveBaseUrl();
    const key = getKeyToUse("<API_KEY_FROM_DASHBOARD>");
    const model = selectedModel || DEFAULT_MODEL;

    switch (tool.id) {
      case "pi": {
        const ids = selectedModels.length > 0 ? selectedModels : [model];
        const models = ids.map((id) => ({ id, name: id, contextWindow: 128000, maxTokens: 16384 }));
        const content = { providers: { durindoor: { baseUrl: url, apiKey: key, api: "openai-completions", models } } };
        return [{ filename: "~/.pi/agent/models.json", content: JSON.stringify(content, null, 2) }];
      }
      case "crush": {
        const content = { providers: { durindoor: { type: "openai-compat", base_url: url, api_key: key, models: [{ id: model, name: model, context_window: 128000 }] } } };
        return [{ filename: "~/.config/crush/crush.json", content: JSON.stringify(content, null, 2) }];
      }
      case "forge":
        return [{ filename: "~/.forge/config.toml", content: `# ForgeCode config - managed by DurinDoor\n\n[openai]\napi_key = "${key}"\nbase_url = "${url}"\nmodel = "${model}"\n` }];
      case "smelt":
        return [{ filename: "~/.smelt/config.json", content: JSON.stringify({ baseUrl: url, apiKey: key, model, _managedBy: "durindoor" }, null, 2) }];
      case "codewhale":
        return [{ filename: "~/.codewhale/config.toml", content: `# CodeWhale config - managed by DurinDoor\n\n[openai]\napi_key = "${key}"\nbase_url = "${url}"\nmodel = "${model}"\n` }];
      default:
        return [];
    }
  };

  const applyDisabled = multiModel ? false : !selectedModel;

  return (
    <Card padding={false} className="overflow-hidden p-4">
      <button type="button" aria-expanded={isExpanded} className="w-full min-h-11 text-left outline-none focus-visible:shadow-dd-focus flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            {tool.image ?
              <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-dd-lg" sizes="32px" onError={(e) => {e.target.style.display = "none";}} /> :
              <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-dd-accent">terminal</span>
            }
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

      {isExpanded &&
      <div className="mt-4 pt-4 border-t border-dd-border flex flex-col gap-4">
          {checking &&
        <div className="flex items-center gap-2 text-dd-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking {tool.name}...</span>
            </div>
        }

          {!checking && status && !status.installed &&
        <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-dd-warning/10 border border-dd-warning/30 rounded-dd-lg">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="material-symbols-outlined text-dd-warning">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-dd-warning">{tool.name} not detected locally</p>
                    <p className="text-sm text-dd-muted mt-1">Manual configuration is still available if DurinDoor is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-dd-surface !border-dd-warning/40 !text-dd-warning">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  <Button variant="ghost" size="sm" aria-expanded={showInstallGuide} onClick={() => setShowInstallGuide((v) => !v)}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide &&
          <div className="p-4 bg-dd-surface-2 border border-dd-border rounded-dd-lg flex flex-col gap-2 text-sm">
                  <p className="text-dd-muted">Install command:</p>
                  <code className="block p-2 bg-dd-surface-3 rounded-dd text-xs font-mono break-all">{INSTALL_COMMANDS[tool.id] || `npm install -g ${tool.id}`}</code>
                  {tool.docsUrl &&
            <p className="text-xs text-dd-muted">
                      Docs: <a href={tool.docsUrl} target="_blank" rel="noreferrer" className="text-dd-accent hover:underline">{tool.docsUrl}</a>
                    </p>
            }
                </div>
          }
            </div>
        }

          {!checking && status?.installed &&
        <>
              <div className="flex flex-col gap-2">
                {tool.notes?.length > 0 &&
            <div className="flex flex-col gap-2 mb-2">
                    {tool.notes.map((note, idx) =>
              <div key={idx} className={`flex items-start gap-2 p-2 rounded-dd text-xs ${
              note.type === "warning" ? "bg-dd-warning/10 text-dd-warning" :
              note.type === "error" ? "bg-dd-danger/10 text-dd-danger" :
              "bg-dd-info/10 text-dd-info"}`
              }>
                        <span aria-hidden="true" className="material-symbols-outlined text-[14px] mt-0.5">
                          {note.type === "warning" ? "warning" : note.type === "error" ? "error" : "info"}
                        </span>
                        <span>{note.text}</span>
                      </div>
              )}
                  </div>
            }

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Select Endpoint</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                value={customBaseUrl || getEffectiveBaseUrl()}
                onChange={setCustomBaseUrl}
                requiresExternalUrl={tool.requiresExternalUrl}
                tunnelEnabled={tunnelEnabled}
                tunnelPublicUrl={tunnelPublicUrl}
                tailscaleEnabled={tailscaleEnabled}
                tailscaleUrl={tailscaleUrl} />
                </div>

                {currentBaseUrl &&
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Current</span>
                    <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded-dd bg-dd-surface-2 px-2 py-2 text-xs text-dd-muted sm:py-1.5">{currentBaseUrl}</span>
                  </div>
            }

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">API Key</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {multiModel ?
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                    <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm sm:mt-1.5">Models</span>
                    <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline sm:mt-2">arrow_forward</span>
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex min-h-9 flex-wrap gap-1.5 rounded-dd border border-dd-border bg-dd-surface p-2">
                        {selectedModels.length === 0 ?
                  <span className="text-xs italic text-dd-muted">No models selected. Add models to use in {tool.name}.</span> :
                  selectedModels.map((modelId) =>
                  <span key={modelId} className="inline-flex items-center gap-1 rounded-dd border border-dd-border bg-dd-surface-2 pl-2 text-xs text-dd-text">
                            <span className="break-all">{modelId}</span>
                            <IconButton icon="close" label={`Remove ${modelId}`} size="sm" onClick={() => setSelectedModels((prev) => prev.filter((m) => m !== modelId))} className="text-dd-muted hover:text-dd-danger" />
                          </span>
                  )
                  }
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)} disabled={!canSelectModel}>
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">add</span>Add Model
                        </Button>
                        {activeProviders.length > 0 &&
                  <Button variant="ghost" size="sm" onClick={handleAddAllActiveModels}>Add All Active Models</Button>
                  }
                        {selectedModels.length > 0 &&
                  <Button variant="ghost" size="sm" onClick={() => setSelectedModels([])} className="ml-auto text-dd-muted hover:text-dd-danger">Clear all</Button>
                  }
                      </div>
                    </div>
                  </div> :

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Default Model</span>
                    <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input type="text" aria-label="Model ID" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder={DEFAULT_MODEL} className="w-full min-w-0 pl-2 pr-12 py-2 bg-dd-surface rounded-dd border border-dd-border text-xs focus:outline-none focus:ring-1 focus-visible:shadow-dd-focus sm:py-1.5" />
                      {selectedModel && <IconButton icon="close" label="Clear model" size="sm" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 text-dd-muted hover:text-dd-danger" />}
                    </div>
                    <Button onClick={() => setModalOpen(true)} disabled={!canSelectModel} className={`w-full sm:w-auto rounded-dd border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${canSelectModel ? "bg-dd-surface border-dd-border text-dd-text hover:border-dd-accent cursor-pointer" : "opacity-50 cursor-not-allowed border-dd-border"}`}>Select</Button>
                  </div>
            }
              </div>

              {message &&
          <div className={`flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs ${message.type === "success" ? "bg-dd-success/10 text-dd-success" : "bg-dd-danger/10 text-dd-danger"}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
          }

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={applyDisabled} loading={applying}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="secondary" size="sm" onClick={handleReset} disabled={!status?.has9Router} loading={restoring}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
        }
        </div>
      }

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleSelectModel}
        selectedModel={multiModel ? null : selectedModel}
        activeProviders={activeProviders}
        title={`Select Model for ${tool.name}`} />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title={`${tool.name} - Manual Configuration`}
        configs={getManualConfigs()} />
    </Card>);

}
