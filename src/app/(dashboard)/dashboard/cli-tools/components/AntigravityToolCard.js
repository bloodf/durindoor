"use client";

import { useState, useEffect } from "react";
import { ModelSelectModal } from "@/shared/components";
import Modal from "@/shared/ui/components/Modal";
import { Card } from "@/shared/ui/components/Card";
import Button from "@/shared/ui/components/Button";
import IconButton from "@/shared/ui/components/IconButton";
import { Badge } from "@/shared/ui/components/Badge";
import Input from "@/shared/ui/components/Input";
import Image from "next/image";
import ApiKeySelect from "./ApiKeySelect";

export default function AntigravityToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders,
  hasActiveProviders,
  cloudEnabled,
  initialStatus,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [loading, setLoading] = useState(false);
  const [startingStep, setStartingStep] = useState(null); // "cert" | "server" | "dns" | null
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [message, setMessage] = useState(null);
  const [modelMappings, setModelMappings] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);
  const [modelAliases, setModelAliases] = useState({});

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
      fetchStatus();
      loadSavedMappings();
      fetchModelAliases();
    }
    if (isExpanded) {
      loadSavedMappings();
      fetchModelAliases();
    }
  }, [isExpanded]);

  const loadSavedMappings = async () => {
    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm/alias?tool=antigravity");
      if (res.ok) {
        const data = await res.json();
        const aliases = data.aliases || {};

        if (Object.keys(aliases).length > 0) {
          setModelMappings(aliases);
        }
      }
    } catch (error) {
      console.log("Error loading saved mappings:", error);
    }
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

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.log("Error fetching status:", error);
      setStatus({ running: false });
    }
  };

  // MITM elevation is decided by the server OS, not by this browser's OS.
  const serverIsWindows = status?.isWin === true;
  const canRunWithoutPassword = serverIsWindows || status?.hasCachedPassword || status?.needsSudoPassword === false;

  const handleStart = () => {
    if (canRunWithoutPassword) {
      doStart("");
    } else {
      setShowPasswordModal(true);
      setMessage(null);
    }
  };

  const handleStop = () => {
    if (canRunWithoutPassword) {
      doStop("");
    } else {
      setShowPasswordModal(true);
      setMessage(null);
    }
  };

  const doStart = async (password) => {
    setLoading(true);
    setMessage(null);
    // Show steps progressing in order
    setStartingStep("cert");
    try {
      const keyToUse = selectedApiKey?.trim()
        || (!cloudEnabled ? "sk_durindoor" : null);

      const res = await fetch("/api/cli-tools/antigravity-mitm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyToUse, sudoPassword: password }),
      });

      const data = await res.json();
      if (res.ok) {
        setStartingStep(null);
        setMessage({ type: "success", text: "MITM started" });
        setShowPasswordModal(false);
        setSudoPassword("");
        fetchStatus();
      } else {
        setStartingStep(null);
        setMessage({ type: "error", text: data.error || "Failed to start" });
      }
    } catch (error) {
      setStartingStep(null);
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const doStop = async (password) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: password }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "MITM stopped" });
        setShowPasswordModal(false);
        setSudoPassword("");
        fetchStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to stop" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPassword = () => {
    if (!sudoPassword.trim()) {
      setMessage({ type: "error", text: "Sudo password is required" });
      return;
    }
    if (status?.running) {
      doStop(sudoPassword);
    } else {
      doStart(sudoPassword);
    }
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (currentEditingAlias) {
      setModelMappings(prev => ({
        ...prev,
        [currentEditingAlias]: model.value,
      }));
    }
  };

  const handleModelMappingChange = (alias, value) => {
    setModelMappings(prev => ({
      ...prev,
      [alias]: value,
    }));
  };

  const handleSaveMappings = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "antigravity", mappings: modelMappings }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save mappings");
      }

      setMessage({ type: "success", text: "Mappings saved!" });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const isRunning = status?.running;

  return (
    <Card padding={false} className="overflow-hidden p-4">
      <button type="button" aria-expanded={isExpanded} className="w-full text-left outline-none focus-visible:shadow-dd-focus flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>

        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image
              src="/providers/antigravity.png"
              alt={tool.name}
              width={32}
              height={32}
              className="size-8 object-contain rounded-dd-lg"
              sizes="32px"
              onError={(e) => { e.target.style.display = "none"; }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {isRunning ? (
                <Badge tone="success" size="sm">Active</Badge>
              ) : (
                <Badge tone="neutral" size="sm">Inactive</Badge>
              )}
            </div>
            <p className="text-xs text-dd-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span aria-hidden="true" className={`material-symbols-outlined text-dd-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-dd-border flex flex-col gap-4">
          {/* Status indicators — ordered: Cert → Server → DNS */}
          <div className="flex items-center gap-1">
            {[
              { key: "cert", label: "Cert", ok: status?.certExists },
              { key: "server", label: "Server", ok: status?.running },
              { key: "dns", label: "DNS", ok: status?.dnsConfigured },
            ].map(({ key, label, ok }, i) => {
              const isLoading = startingStep === key;
              return (
                <div key={key} className="flex items-center">
                  <div className="flex items-center gap-1 px-2 py-1 rounded-dd">
                    {isLoading ? (
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-dd-accent animate-spin">progress_activity</span>
                    ) : (
                      <span aria-hidden="true" className={`material-symbols-outlined text-[14px] ${ok ? "text-dd-success" : "text-dd-muted"}`}>
                        {ok ? "check_circle" : "radio_button_unchecked"}
                      </span>
                    )}
                    <span className={`text-xs font-medium ${isLoading ? "text-dd-accent" : ok ? "text-dd-success" : "text-dd-muted"}`}>
                      {label}
                    </span>
                  </div>
                  {i < 2 && <span aria-hidden="true" className="material-symbols-outlined text-[12px] text-dd-muted">arrow_forward</span>}
                </div>
              );
            })}
          </div>

          {/* Start/Stop Button */}
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            {isRunning ? (
              <Button
                onClick={handleStop}
                disabled={loading}
                className="px-4 py-2 rounded-dd-lg bg-dd-danger/10 border border-dd-danger/30 text-dd-danger font-medium text-sm flex items-center gap-2 hover:bg-dd-danger/20 transition-colors disabled:opacity-50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">stop_circle</span>
                Stop MITM
              </Button>
            ) : (
              <Button
                onClick={handleStart}
                disabled={loading || !hasActiveProviders}
                className="px-4 py-2 rounded-dd-lg bg-dd-accent-soft border border-dd-accent/30 text-dd-accent font-medium text-sm flex items-center gap-2 hover:bg-dd-accent-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">play_circle</span>
                Start MITM
              </Button>
            )}
          </div>

          {message?.type === "error" && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs bg-dd-danger/10 text-dd-danger">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">error</span>
              <span>{message.text}</span>
            </div>
          )}

          {/* When running: API Key + Model Mappings */}
          {isRunning && (
            <>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">API Key</span>
                <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                <ApiKeySelect
                  value={selectedApiKey}
                  onChange={setSelectedApiKey}
                  apiKeys={apiKeys}
                  cloudEnabled={cloudEnabled}
                />
              </div>

              {tool.defaultModels.map((model) => (
                <div key={model.alias} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">{model.name}</span>
                  <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="relative w-full min-w-0">
                    <input
                      type="text"
                      aria-label={`${model.name} model`}
                      value={modelMappings[model.alias] || ""}
                      onChange={(e) => handleModelMappingChange(model.alias, e.target.value)}
                      placeholder="provider/model-id"
                      className="w-full min-w-0 pl-2 pr-12 py-2 bg-dd-surface rounded-dd border border-dd-border text-xs focus:outline-none focus:ring-1 focus-visible:shadow-dd-focus sm:py-1.5"
                    />
                    {modelMappings[model.alias] && (
                      <IconButton
                        icon="close"
                        label={`Clear ${model.name} model`}
                        size="sm"
                        onClick={() => handleModelMappingChange(model.alias, "")}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-dd-muted hover:text-dd-danger"
                      />
                    )}
                  </div>
                  <Button
                    onClick={() => openModelSelector(model.alias)}
                    disabled={!hasActiveProviders}
                    className={`w-full sm:w-auto rounded-dd border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-dd-surface border-dd-border text-dd-text hover:border-dd-accent cursor-pointer" : "opacity-50 cursor-not-allowed border-dd-border"}`}
                  >
                    Select
                  </Button>
                </div>
              ))}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveMappings}
                  disabled={loading || Object.keys(modelMappings).length === 0}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] mr-1">save</span>
                  Save Mappings
                </Button>
              </div>
            </>
          )}

          {/* Windows privilege boundary */}
          {!isRunning && serverIsWindows && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs bg-dd-warning/10 text-dd-warning border border-dd-warning/20">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">warning</span>
              <span>Windows: keep DurinDoor in standard-user mode; UAC is requested only for system configuration.</span>
            </div>
          )}

          {/* When stopped: how it works */}
          {!isRunning && (
            <div className="flex flex-col gap-1.5 px-1">
              <p className="text-xs text-dd-muted">
                <span className="font-medium text-dd-text">How it works:</span> Intercepts Antigravity traffic via DNS redirect, letting you reroute models through DurinDoor.
              </p>
              <div className="flex flex-col gap-0.5 text-[11px] text-dd-muted">
                <span>1. Generates SSL cert & adds to system keychain</span>
                <span>2. Redirects <code className="text-[10px] bg-dd-surface px-1 rounded-dd">daily-cloudcode-pa.googleapis.com</code> → localhost</span>
                <span>3. Maps Antigravity models to any provider via DurinDoor</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Password Modal */}
      <Modal
        open={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false);
          setSudoPassword("");
          setMessage(null);
        }}
        title="Sudo Password Required"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 p-3 bg-dd-warning/10 border border-dd-warning/30 rounded-dd-lg">
            <span aria-hidden="true" className="material-symbols-outlined text-dd-warning text-[20px]">warning</span>
            <p className="text-xs text-dd-muted">Required for SSL certificate and DNS configuration</p>
          </div>

          <Input
            label="Sudo password"
            type="password"
            placeholder="Enter sudo password"
            value={sudoPassword}
            onChange={(e) => setSudoPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleConfirmPassword();
            }}
          />

          {message && (
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs ${message.type === "success" ? "bg-dd-success/10 text-dd-success" : "bg-dd-danger/10 text-dd-danger"}`}>
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
              <span>{message.text}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowPasswordModal(false); setSudoPassword(""); setMessage(null); }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmPassword}
              loading={loading}
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleModelSelect}
        selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={`Select model for ${currentEditingAlias}`}
      />
    </Card>
  );
}
