"use client";

import { useState, useEffect } from "react";
import { ManualConfigModal, ComboFormModal, McpMarketplaceModal, ModelSelectModal } from "@/shared/components";
import { Card } from "@/shared/ui/components/Card";
import Button from "@/shared/ui/components/Button";
import IconButton from "@/shared/ui/components/IconButton";
import { Badge } from "@/shared/ui/components/Badge";
import Modal from "@/shared/ui/components/Modal";
import Input from "@/shared/ui/components/Input";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";

const ENDPOINT = "/api/cli-tools/cowork-settings";

const stripV1 = (url) => (url || "").replace(/\/v1\/?$/, "");
const ensureV1 = (url) => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

export default function CoworkToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders,
  hasActiveProviders,
  cloudEnabled,
  cloudUrl,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  initialStatus,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [plugins, setPlugins] = useState([]);
  const [localPlugins, setLocalPlugins] = useState([]);
  const [customPlugins, setCustomPlugins] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [comboModalOpen, setComboModalOpen] = useState(false);
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  const [addMcpForm, setAddMcpForm] = useState({ name: "", url: "" });

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) checkStatus();
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    fetch("/api/models/alias")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setModelAliases(data.aliases || {});
      })
      .catch(() => {});
  }, [isExpanded]);

  useEffect(() => {
    if (status?.cowork?.models?.length) {
      setSelectedModels(status.cowork.models);
    }
    if (status?.cowork?.baseUrl && !customBaseUrl) {
      setCustomBaseUrl(stripV1(status.cowork.baseUrl));
    }
    // Initialize plugins: from current config, fallback to defaultPlugins
    if (Array.isArray(status?.cowork?.plugins) && status.cowork.plugins.length > 0) {
      setPlugins(status.cowork.plugins);
    } else if (plugins.length === 0 && Array.isArray(status?.defaultPlugins)) {
      setPlugins(status.defaultPlugins);
    }
    if (Array.isArray(status?.cowork?.localPlugins)) {
      setLocalPlugins(status.cowork.localPlugins);
    }
    if (Array.isArray(status?.cowork?.customPlugins) && status.cowork.customPlugins.length > 0) {
      setCustomPlugins(status.cowork.customPlugins);
    }
  }, [status]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const getEffectiveBaseUrl = () => ensureV1(customBaseUrl);

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    const url = status?.cowork?.baseUrl;
    if (!url) return "not_configured";
    return status.has9Router ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const handleApply = async () => {
    setMessage(null);
    const effectiveUrl = getEffectiveBaseUrl();

    if (selectedModels.length === 0) {
      setMessage({ type: "error", text: "Please select at least one model" });
      return;
    }

    setApplying(true);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (!cloudEnabled ? "sk_durindoor" : null);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: effectiveUrl,
          apiKey: keyToUse,
          models: selectedModels,
          plugins,
          localPlugins,
          customPlugins,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied. Quit & reopen Claude Desktop to load." });
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

  const handleCreateCombo = async ({ name, models }) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, models }),
      });
      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to create combo" });
        return;
      }
      if (!selectedModels.includes(name)) {
        setSelectedModels([...selectedModels, name]);
      }
      setComboModalOpen(false);
      setMessage({ type: "success", text: `Combo "${name}" created and added.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  const handleAddModel = (model) => {
    const value = model?.value || model?.name || model;
    if (!value || selectedModels.includes(value)) return;
    setSelectedModels((prev) => [...prev, value]);
  };

  const handleRemoveModel = (model) => {
    const value = model?.value || model?.name || model;
    setSelectedModels((prev) => prev.filter((item) => item !== value));
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully" });
        setSelectedModels([]);
        setPlugins(status?.defaultPlugins || []);
        setLocalPlugins([]);
        setCustomPlugins([]);
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const addPlugin = (p) => {
    if (plugins.some((x) => x.name === p.name)) return;
    setPlugins([...plugins, p]);
  };

  const removePlugin = (name) => {
    setPlugins(plugins.filter((p) => p.name !== name));
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_durindoor" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const cfg = {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: getEffectiveBaseUrl() || "https://your-public-host/v1",
      inferenceGatewayApiKey: keyToUse,
      inferenceModels: modelsToShow.map((name) => ({ name })),
    };

    return [{
      filename: "~/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json",
      content: JSON.stringify(cfg, null, 2),
    }];
  };

  return (
    <Card padding={false} className="overflow-hidden p-4">
      <button type="button" aria-expanded={isExpanded} className="w-full text-left outline-none focus-visible:shadow-dd-focus flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>

        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-dd-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
              <span>Checking Claude Cowork...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-3 p-4 bg-dd-warning/10 border border-dd-warning/30 rounded-dd-lg">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined text-dd-warning">warning</span>
                <div className="flex-1">
                  <p className="font-medium text-dd-warning">Claude Desktop (Cowork mode) not detected</p>
                  <p className="text-sm text-dd-muted">Open Claude Desktop → Help → Troubleshooting → Enable Developer mode → Configure third-party inference, then return here.</p>
                </div>
              </div>
              <div className="pl-9">
                <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-dd-surface !border-dd-warning/40 !text-dd-warning">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                  Manual Config
                </Button>
              </div>
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Select Endpoint</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={getEffectiveBaseUrl()}
                    onChange={(url) => setCustomBaseUrl(stripV1(url))}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                    cloudEnabled={cloudEnabled}
                    cloudUrl={cloudUrl}
                  />
                </div>

                {status?.cowork?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">Current</span>
                    <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded-dd bg-dd-surface-2 px-2 py-2 text-xs text-dd-muted sm:py-1.5">
                      {status.cowork.baseUrl}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">API Key</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-dd-text text-right">Models</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-dd-muted text-[14px]">arrow_forward</span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-dd-muted">No models selected</span>
                      ) : (
                        selectedModels.map((m) => (
                          <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-dd text-xs bg-dd-surface-2 bg-dd-surface-2 text-dd-muted border border-transparent hover:border-dd-border">
                            {m}
                            <IconButton icon="close" label={`Remove model ${m}`} size="sm" onClick={() => handleRemoveModel(m)} className="ml-0.5 hover:text-dd-danger" />
                          </span>
                        ))
                      )}
                    </div>
                    <Button onClick={() => setComboModalOpen(true)} disabled={!hasActiveProviders} className={`shrink-0 px-2 py-1.5 rounded-dd border text-xs whitespace-nowrap transition-colors ${hasActiveProviders ? "bg-dd-accent-soft border-dd-accent/40 text-dd-accent hover:bg-dd-accent-soft cursor-pointer" : "opacity-50 cursor-not-allowed border-dd-border"}`}>+ Combo</Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-dd-text text-right pt-2">MCP</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-dd-muted text-[14px] mt-2">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1">
                    {/* Preset plugins */}
                    {plugins.filter((p) => p.name !== "exa").map((p) => (
                      <div key={p.name} className="flex items-center gap-2 px-2 py-1 bg-dd-surface rounded-dd border border-dd-border">
                        <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">{p.title || p.name}</span>
                        {p.oauth && <span className="text-[8px] text-dd-warning shrink-0">OAuth</span>}
                        <div className="flex max-h-6 flex-1 flex-wrap gap-1 overflow-hidden">
                          {Array.isArray(p.toolNames) && p.toolNames.slice(0, 6).map((t) => (
                            <span key={t} className="text-[9px] px-1 py-0.5 rounded-dd bg-dd-surface-2 bg-dd-surface-2 text-dd-muted whitespace-nowrap">{t}</span>
                          ))}
                          {Array.isArray(p.toolNames) && p.toolNames.length > 6 && (
                            <span className="text-[9px] px-1 py-0.5 rounded-dd bg-dd-surface-2 bg-dd-surface-2 text-dd-muted whitespace-nowrap">+{p.toolNames.length - 6}</span>
                          )}
                        </div>
                        <IconButton icon="close" label={`Remove plugin ${p.name}`} size="sm" onClick={() => removePlugin(p.name)} className="ml-auto shrink-0 hover:text-dd-danger" />
                      </div>
                    ))}
                    {/* Custom plugins */}
                    {customPlugins.map((p) => (
                      <div key={p.name} className="flex items-center gap-2 px-2 py-1 bg-dd-surface rounded-dd border border-dd-border">
                        <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">{p.name}</span>
                        <span className="text-[8px] px-1 py-0.5 rounded-dd bg-dd-info/10 text-dd-info shrink-0">custom</span>
                        <span className="flex-1 text-[9px] text-dd-muted truncate">{p.url}</span>
                        <IconButton icon="close" label={`Remove plugin ${p.name}`} size="sm" onClick={() => setCustomPlugins(customPlugins.filter((x) => x.name !== p.name))} className="ml-auto shrink-0 hover:text-dd-danger" />
                      </div>
                    ))}
                    {plugins.filter((p) => p.name !== "exa").length === 0 && customPlugins.length === 0 && (
                      <div className="px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border text-xs text-dd-muted">No MCPs added</div>
                    )}
                    {/* Actions row */}
                    <div className="flex items-center gap-2 mt-0.5">
                      <Button onClick={() => setMarketplaceOpen(true)} className="px-2 py-1 rounded-dd border text-xs bg-dd-accent-soft border-dd-accent/40 text-dd-accent hover:bg-dd-accent-soft cursor-pointer whitespace-nowrap">
                        + Browse
                      </Button>
                      <Button onClick={() => { setAddMcpForm({ name: "", url: "" }); setAddMcpOpen(true); }} className="px-2 py-1 rounded-dd border text-xs bg-dd-surface border-dd-border text-dd-muted hover:border-dd-accent hover:text-dd-accent cursor-pointer whitespace-nowrap">
                        + Custom
                      </Button>
                      <a href="https://mcp.so" target="_blank" rel="noopener noreferrer" className="text-[10px] text-dd-muted hover:text-dd-accent underline ml-auto">Find MCPs →</a>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-dd-text text-right pt-1">Tools</span>
                  <span aria-hidden="true" className="material-symbols-outlined text-dd-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1.5">
                    {(() => {
                      const exaEnabled = plugins.some((p) => p.name === "exa");
                      const exaDef = (status?.defaultPlugins || []).find((d) => d.name === "exa");
                      return (
                        <label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border">
                          <input
                            type="checkbox"
                            checked={exaEnabled}
                            onChange={(e) => {
                              if (e.target.checked && exaDef) setPlugins([...plugins.filter((p) => p.name !== "exa"), exaDef]);
                              else setPlugins(plugins.filter((p) => p.name !== "exa"));
                            }}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium">Web Search & Fetch (Exa)</div>
                            <p className="text-[10px] text-dd-muted leading-snug">Replaces built-in WebSearch/WebFetch. Auto-strips duplicates from tool list.</p>
                          </div>
                        </label>
                      );
                    })()}
                    {(() => {
                      const browserDef = (status?.localStdioPlugins || []).find((p) => p.name === "browsermcp");
                      if (!browserDef) return null;
                      const browserEnabled = localPlugins.includes("browsermcp");
                      return (
                        <label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border">
                          <input
                            type="checkbox"
                            checked={browserEnabled}
                            onChange={(e) => setLocalPlugins(e.target.checked ? [...localPlugins, "browsermcp"] : localPlugins.filter((n) => n !== "browsermcp"))}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium">Browser Control (Browser MCP)</div>
                            <p className="text-[10px] text-dd-muted leading-snug">
                              Controls your running Chrome. Auto-strips Cowork&apos;s built-in browser tools.{" "}
                              <a href={browserDef.extensionUrl} target="_blank" rel="noopener noreferrer" className="text-dd-accent underline">Install Chrome extension</a>
                            </p>
                          </div>
                        </label>
                      );
                    })()}
                  </div>
                </div>

                {Array.isArray(status?.localStdioPlugins) && status.localStdioPlugins.filter((p) => p.name !== "browsermcp").length > 0 && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                    <span className="w-32 shrink-0 text-sm font-semibold text-dd-text text-right pt-1">Local Plugins</span>
                    <span aria-hidden="true" className="material-symbols-outlined text-dd-muted text-[14px] mt-1.5">arrow_forward</span>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="flex flex-col gap-1.5 px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border">
                        {status.localStdioPlugins.filter((p) => p.name !== "browsermcp").map((p) => {
                          const enabled = localPlugins.includes(p.name);
                          return (
                            <label key={p.name} className="flex items-start gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => setLocalPlugins(e.target.checked ? [...localPlugins, p.name] : localPlugins.filter((n) => n !== p.name))}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-medium">{p.title}</span>
                                  <span className="text-[8px] text-dd-warning">stdio</span>
                                </div>
                                <p className="text-[10px] text-dd-muted leading-snug">{p.description}</p>
                                {p.extensionUrl && (
                                  <a href={p.extensionUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-dd-accent underline">Install Chrome extension</a>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <p className="flex items-start gap-1 text-[10px] text-dd-muted leading-snug">
                        <span aria-hidden="true" className="material-symbols-outlined text-[12px] text-dd-warning">warning</span>
                        <span>
                          Local plugins run as subprocess via <code className="rounded-dd bg-dd-surface-2 px-1 py-0.5">npx</code>. Requires Node.js installed.
                        </span>
                      </p>
                      </div>
                    </div>
                )}
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs ${message.type === "success" ? "bg-dd-success/10 text-dd-success" : "bg-dd-danger/10 text-dd-danger"}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying} className="w-full sm:w-auto">
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="secondary" size="sm" onClick={handleReset} disabled={!status.has9Router} loading={restoring} className="w-full sm:w-auto">
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto">
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Claude Cowork - Manual Configuration"
        configs={getManualConfigs()}
      />

      <ComboFormModal
        isOpen={comboModalOpen}
        combo={null}
        onClose={() => setComboModalOpen(false)}
        onSave={handleCreateCombo}
        activeProviders={activeProviders}
        forcePrefix="claude-"
        title="Create Cowork Combo"
      />

      <ModelSelectModal
        isOpen={modelSelectOpen}
        onClose={() => setModelSelectOpen(false)}
        onSelect={handleAddModel}
        onDeselect={handleRemoveModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Cowork Model"
        addedModelValues={selectedModels}
        closeOnSelect={false}
      />

      <McpMarketplaceModal
        isOpen={marketplaceOpen}
        onClose={() => setMarketplaceOpen(false)}
        onAdd={addPlugin}
        addedNames={plugins.map((p) => p.name)}
      />

      {/* Add Custom MCP modal */}
      <Modal
        open={addMcpOpen}
        onClose={() => setAddMcpOpen(false)}
        title="Add Custom MCP"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAddMcpOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const name = addMcpForm.name.trim();
                if (!name || !addMcpForm.url.trim()) return;
                setCustomPlugins((prev) => [...prev.filter((x) => x.name !== name), { name, url: addMcpForm.url.trim(), transport: "sse", custom: true }]);
                setAddMcpOpen(false);
              }}
            >
              Add
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            size="sm"
            label="Name"
            placeholder="my-mcp"
            value={addMcpForm.name}
            onChange={(e) => setAddMcpForm((f) => ({ ...f, name: e.target.value.replace(/\s+/g, "-").toLowerCase() }))}
          />
          <Input
            size="sm"
            label="SSE URL"
            placeholder="https://your-mcp-server.com/sse"
            value={addMcpForm.url}
            onChange={(e) => setAddMcpForm((f) => ({ ...f, url: e.target.value }))}
          />
        </div>
      </Modal>
    </Card>
  );
}
