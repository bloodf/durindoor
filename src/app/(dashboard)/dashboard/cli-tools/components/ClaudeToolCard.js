"use client";

import { useState, useEffect, useRef } from "react";
import { ModelSelectModal, ManualConfigModal, Tooltip } from "@/shared/components";
import { Card } from "@/shared/ui/components/Card";
import Button from "@/shared/ui/components/Button";
import IconButton from "@/shared/ui/components/IconButton";
import { Badge } from "@/shared/ui/components/Badge";
import Select from "@/shared/ui/components/Select";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

// Auto-compact window presets (CLAUDE_CODE_AUTO_COMPACT_WINDOW, valid 100K–1M).
// UI shows the round number; the value written is nudged down 2K to stay safely
// under the upstream hard cap.
const CONTEXT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "200K", value: "198000" },
  { label: "300K", value: "298000" },
  { label: "500K", value: "498000" },
  { label: "700K", value: "698000" },
];

const CONTEXT_MARKER = /(?:\[1m\])+$/i;

/** Return a model ID with exactly the requested Claude Code 1M marker state. */
export function withContextMarker(value, enabled) {
  const model = value.replace(CONTEXT_MARKER, "");
  return enabled ? `${model}[1m]` : model;
}

export default function ClaudeToolCard({
  tool,
  isExpanded,
  onToggle,
  activeProviders,
  modelMappings,
  onModelMappingChange,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [claudeStatus, setClaudeStatus] = useState(initialStatus || null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [ccFilterNaming, setCcFilterNaming] = useState(false);
  const [autoCompactWindow, setAutoCompactWindow] = useState("");
  const [oneMContext, setOneMContext] = useState(false);
  const hasInitializedModels = useRef(false);

  const handleOneMContextToggle = (enabled) => {
    setOneMContext(enabled);
    tool.defaultModels.forEach((model) => {
      const current = modelMappings[model.alias];
      if (current) onModelMappingChange(model.alias, withContextMarker(current, enabled));
    });
  };

  const getConfigStatus = () => {
    if (!claudeStatus?.installed) return null;
    const currentUrl = claudeStatus.settings?.env?.ANTHROPIC_BASE_URL;
    if (!currentUrl) return "not_configured";
    if (matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (initialStatus) setClaudeStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    const value = claudeStatus?.settings?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    setAutoCompactWindow(value || "");
  }, [claudeStatus?.settings?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW]);

  useEffect(() => {
    const env = claudeStatus?.settings?.env;
    if (!env) return;
    setOneMContext(tool.defaultModels.some((model) => CONTEXT_MARKER.test(env[model.envKey] || "")));
  }, [claudeStatus?.settings?.env, tool.defaultModels]);

  useEffect(() => {
    if (isExpanded && !claudeStatus) {
      checkClaudeStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      setCcFilterNaming(!!data.ccFilterNaming);
    }).catch(() => {});
  }, []);

  const handleCcFilterNamingToggle = async (e) => {
    const value = e.target.checked;
    setCcFilterNaming(value);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ccFilterNaming: value }),
    }).catch(() => {});
  };

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  useEffect(() => {
    if (claudeStatus?.installed && !hasInitializedModels.current) {
      hasInitializedModels.current = true;
      const env = claudeStatus.settings?.env || {};

      tool.defaultModels.forEach((model) => {
        if (model.envKey) {
          const value = env[model.envKey] || model.defaultValue || "";
          // Only sync initial values from file once
          if (value) {
            onModelMappingChange(model.alias, value);
          }
        }
      });
    }
  }, [claudeStatus, tool.defaultModels, onModelMappingChange]);

  const checkClaudeStatus = async () => {
    setCheckingClaude(true);
    try {
      const res = await fetch("/api/cli-tools/claude-settings");
      const data = await res.json();
      setClaudeStatus(data);
    } catch (error) {
      setClaudeStatus({ installed: false, error: error.message });
    } finally {
      setCheckingClaude(false);
    }
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl() };

      // Management APIs never return stored secrets; operators paste a saved
      // credential or use the local no-auth placeholder.
      const keyToUse = selectedApiKey?.trim()
        || (!cloudEnabled ? "sk_durindoor" : null);

      if (keyToUse) {
        env.ANTHROPIC_AUTH_TOKEN = keyToUse;
      }

      tool.defaultModels.forEach((model) => {
        const targetModel = modelMappings[model.alias];
        if (targetModel && model.envKey) env[model.envKey] = targetModel.replace(/^cc\//, "");
      });
      if (autoCompactWindow) {
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = autoCompactWindow;
      }

      const res = await fetch("/api/cli-tools/claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, autoCompactWindow }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        setClaudeStatus(prev => ({ ...prev, hasBackup: true, settings: { ...prev?.settings, env } }));
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/claude-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setAutoCompactWindow("");
        setOneMContext(false);
        tool.defaultModels.forEach((model) => onModelMappingChange(model.alias, model.defaultValue || ""));
        setSelectedApiKey("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (currentEditingAlias) onModelMappingChange(currentEditingAlias, model.value);
  };

  // Generate settings.json content for manual copy
  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_durindoor" : "<API_KEY_FROM_DASHBOARD>");
    const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl(), ANTHROPIC_AUTH_TOKEN: keyToUse };
    tool.defaultModels.forEach((model) => {
      const targetModel = modelMappings[model.alias];
      if (targetModel && model.envKey) env[model.envKey] = targetModel.replace(/^cc\//, "");
    });
    if (autoCompactWindow) {
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = autoCompactWindow;
    }

    return [
      {
        filename: "~/.claude/settings.json",
        content: JSON.stringify({ hasCompletedOnboarding: true, env }, null, 2),
      },
    ];
  };

  return (
    <Card padding={false} className="overflow-hidden p-4">
      <button type="button" aria-expanded={isExpanded} className="w-full min-h-11 text-left outline-none focus-visible:shadow-dd-focus flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>

        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/claude.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-dd-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
          {checkingClaude && (
            <div className="flex items-center gap-2 text-dd-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Claude CLI...</span>
            </div>
          )}

          {!checkingClaude && claudeStatus && !claudeStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-dd-warning/10 border border-dd-warning/30 rounded-dd-lg">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="material-symbols-outlined text-dd-warning">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-dd-warning">Claude CLI not detected locally</p>
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
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-dd-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-dd-surface-2 bg-dd-surface-2 rounded-dd font-mono text-xs">npm install -g @anthropic-ai/claude-code</code>
                    </div>
                    <p className="text-dd-muted">After installation, run <code className="px-1 bg-dd-surface-2 bg-dd-surface-2 rounded-dd">claude</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingClaude && claudeStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Endpoint (selector) */}
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

                {/* Current configured */}
                {claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Current</span>
                    <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded-dd bg-dd-surface-2 px-2 py-2 text-xs text-dd-muted sm:py-1.5">
                      {claudeStatus.settings.env.ANTHROPIC_BASE_URL}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">API Key</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Model Mappings */}
                {tool.defaultModels.map((model) => (
                  <div key={model.alias} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">{model.name}</span>
                    <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input type="text" aria-label={`${model.name} model`} value={modelMappings[model.alias] || ""} onChange={(e) => onModelMappingChange(model.alias, e.target.value)} placeholder="provider/model-id" className="min-h-11 w-full min-w-0 pl-2 pr-12 rounded-dd border border-dd-border bg-dd-surface text-xs focus:outline-none focus:ring-1 focus-visible:shadow-dd-focus" />
                      {modelMappings[model.alias] && <IconButton icon="close" label={`Clear ${model.name} model`} size="sm" onClick={() => onModelMappingChange(model.alias, "")} className="absolute right-1 top-1/2 -translate-y-1/2 text-dd-muted hover:text-dd-danger" />}
                    </div>
                    <Button onClick={() => openModelSelector(model.alias)} disabled={!hasActiveProviders} className={`min-h-11 w-full rounded-dd border px-2 text-xs transition-colors whitespace-nowrap sm:w-auto sm:shrink-0 ${hasActiveProviders ? "bg-dd-surface border-dd-border text-dd-text hover:border-dd-accent cursor-pointer" : "opacity-50 cursor-not-allowed border-dd-border"}`}>Select Model</Button>
                  </div>
                ))}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Auto-compact</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <Select
                    size="sm"
                    aria-label="Auto-compact"
                    value={autoCompactWindow}
                    onChange={setAutoCompactWindow}
                    options={CONTEXT_OPTIONS}
                  />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">1M context</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="flex items-center gap-1.5">
                    <Toggle
                      size="sm"
                      checked={oneMContext}
                      onChange={handleOneMContextToggle}
                      aria-label="1M context"
                    />
                    <span className="text-xs text-dd-muted">Append [1m] to mapped models</span>
                    <Tooltip text="Claude Code otherwise assumes a 200K window, which clamps auto-compact. Enable only when every mapped model accepts 1M context.">
                      <button type="button" aria-label="About 1M context" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-dd outline-none focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined text-dd-muted text-[14px] cursor-help">info</span></button>
                    </Tooltip>
                  </div>
                </div>

                {/* CC Filter Naming */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Filter naming</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="flex items-center gap-1.5">
                    <label className="flex min-h-11 flex-1 items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={ccFilterNaming} onChange={handleCcFilterNamingToggle} className="w-3.5 h-3.5 accent-dd-accent cursor-pointer" />
                      <span className="text-xs text-dd-muted">Filter naming requests</span>
                    </label>
                    <Tooltip text="Intercepts Claude Code's topic-naming requests and returns a fake response locally, saving API tokens.">
                      <button type="button" aria-label="About filter naming requests" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-dd outline-none focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined text-dd-muted text-[14px] cursor-help">info</span></button>
                    </Tooltip>
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
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!hasActiveProviders} loading={applying}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="secondary" size="sm" onClick={handleResetSettings} disabled={!claudeStatus?.has9Router} loading={restoring}>
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

      <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null} activeProviders={activeProviders} modelAliases={modelAliases} title={`Select model for ${currentEditingAlias}`} />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Claude CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
