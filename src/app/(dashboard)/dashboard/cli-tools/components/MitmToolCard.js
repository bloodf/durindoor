"use client";

import { useState, useEffect, useCallback } from "react";
import MitmModelMappingRow from "./MitmModelMappingRow";
import { ModelSelectModal } from "@/shared/components";
import { Card } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import { TOOL_HOSTS } from "@/shared/constants/mitmToolHosts";
import Image from "next/image";

export default function MitmToolCard({
  tool,
  isExpanded,
  onToggle,
  serverRunning,
  dnsActive,
  hasCachedPassword,
  needsSudoPassword,
  isWin,
  apiKeys,
  activeProviders,
  hasActiveProviders,
  modelAliases = {},
  cloudEnabled,
  onDnsChange,
}) {
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");
  const [pendingDnsAction, setPendingDnsAction] = useState(null);
  const [modalError, setModalError] = useState(null);
  const [modelMappings, setModelMappings] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);

  const mitmHosts = TOOL_HOSTS[tool.id] ?? [];
  const canRunWithoutPassword = isWin || hasCachedPassword || needsSudoPassword === false;

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    fetch(`/api/cli-tools/antigravity-mitm/alias?tool=${tool.id}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data) setModelMappings(data.aliases || {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isExpanded, tool.id]);

  const saveMappings = useCallback(async (mappings) => {
    try {
      await fetch("/api/cli-tools/antigravity-mitm/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.id, mappings }),
      });
    } catch { /* ignore */ }
  }, [tool.id]);

  const getMappingEntry = (alias) => modelMappings[alias] || {};

  const updateMapping = (alias, patch, shouldSave = false) => {
    const updatedEntry = { ...getMappingEntry(alias), ...patch };
    const updated = { ...modelMappings };
    if (updatedEntry.model || updatedEntry.reasoningEffort) updated[alias] = updatedEntry;
    else delete updated[alias];
    setModelMappings(updated);
    if (shouldSave) saveMappings(updated);
  };

  const handleMappingBlur = (alias, value) => {
    updateMapping(alias, { model: value.trim() }, true);
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (!currentEditingAlias || model.isPlaceholder) return;
    updateMapping(currentEditingAlias, { model: model.value }, true);
  };

  const handleDnsToggle = () => {
    if (!serverRunning) return;
    const action = dnsActive ? "disable" : "enable";
    if (canRunWithoutPassword) {
      doDnsAction(action, "");
    } else {
      setPendingDnsAction(action);
      setShowPasswordModal(true);
      setModalError(null);
    }
  };

  const doDnsAction = async (action, password) => {
    setLoading(true);
    setWarning(null);
    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: tool.id, action, sudoPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle DNS");

      if (action === "enable") {
        setWarning(`Restart ${tool.name} to apply changes`);
      }

      setShowPasswordModal(false);
      setSudoPassword("");
      onDnsChange?.(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setPendingDnsAction(null);
    }
  };

  const handleConfirmPassword = () => {
    if (!sudoPassword.trim()) {
      setModalError("Sudo password is required");
      return;
    }
    doDnsAction(pendingDnsAction, sudoPassword);
  };



  const statusTone = !serverRunning ? "neutral" : dnsActive ? "success" : "warning";
  const statusLabel = !serverRunning ? "Server off" : dnsActive ? "Active" : "DNS off";
  return (
    <>
      <Card padding={false} className="overflow-hidden p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={`mitm-tool-body-${tool.id}`}
          className="flex min-h-11 w-full items-start justify-between gap-3 rounded-dd text-left outline-none hover:bg-dd-surface-2 focus-visible:shadow-dd-focus sm:items-center"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center">
              <Image
                src={tool.image}
                alt={tool.name}
                width={32}
                height={32}
                className="size-8 rounded-dd object-contain"
                sizes="32px"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-dd-text">{tool.name}</h3>
                <Badge tone={statusTone} size="sm">{statusLabel}</Badge>
              </div>
              <p className="truncate text-xs text-dd-muted sm:max-w-[40ch]">Intercept {tool.name} requests via MITM proxy</p>
            </div>
          </div>
          <span className={`material-symbols-outlined text-dd-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true">
            expand_more
          </span>
        </button>

        {isExpanded ? (
          <div id={`mitm-tool-body-${tool.id}`} className="mt-4 flex flex-col gap-4 border-t border-dd-border-subtle pt-4">
            {mitmHosts.length > 0 ? (
              <div className="mt-2 rounded-dd border border-dd-border bg-dd-surface-2 px-2 py-1.5">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-dd-text/80">
                  Edit hosts file manually to add the following entries:
                </p>
                <ul className="space-y-0.5 font-mono text-[10px] text-dd-muted break-all">
                  {mitmHosts.map((host) => (
                    <li key={host}>127.0.0.1 {host}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5 px-1 text-[11px] text-dd-muted">
              <p>Toggle DNS to redirect {tool.name} traffic through DurinDoor via MITM.</p>
              {!dnsActive ? (
                <p className="mt-1 text-[10px] text-dd-warning">
                  Enable DNS to edit model mappings
                </p>
              ) : null}
            </div>

            {tool.defaultModels?.length > 0 ? (
              <div className="flex flex-col gap-2">
                {tool.id === "antigravity" ? (
                  <div className="hidden grid-cols-[9rem_minmax(12rem,1fr)_8rem_auto] gap-2 px-2.5 text-[10px] font-medium uppercase tracking-wide text-dd-muted sm:grid">
                    <span />
                    <span>Destination model</span>
                    <span>Reasoning</span>
                    <span />
                  </div>
                ) : null}
                {tool.defaultModels.map((model) => (
                  <MitmModelMappingRow
                    key={model.alias}
                    model={model}
                    entry={getMappingEntry(model.alias)}
                    disabled={!dnsActive}
                    canSelectModel={hasActiveProviders}
                    showReasoning={tool.id === "antigravity"}
                    onModelChange={(value) => updateMapping(model.alias, { model: value })}
                    onModelBlur={(value) => handleMappingBlur(model.alias, value)}
                    onModelClear={() => updateMapping(model.alias, { model: "" }, true)}
                    onModelSelect={() => openModelSelector(model.alias)}
                    onReasoningChange={(value) => updateMapping(model.alias, { reasoningEffort: value }, true)}
                  />
                ))}
              </div>
            ) : null}

            {tool.defaultModels?.length === 0 ? (
              <p className="px-1 text-xs text-dd-muted">Model mappings will be available soon.</p>
            ) : null}

            <div className="flex flex-col gap-2 sm:items-start">
              {dnsActive ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDnsToggle}
                  disabled={!serverRunning || loading}
                  icon="stop_circle"
                  className="w-full sm:w-auto"
                >
                  Stop DNS
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleDnsToggle}
                  disabled={!serverRunning || loading}
                  icon="play_circle"
                  className="w-full sm:w-auto"
                >
                  Start DNS
                </Button>
              )}

              {warning ? (
                <div className="flex items-center gap-2 rounded-dd px-2 py-1.5 text-xs text-dd-warning">
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">warning</span>
                  <span>{warning}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Modal
        open={showPasswordModal}
        onClose={() => { setShowPasswordModal(false); setSudoPassword(""); setModalError(null); }}
        title="Sudo Password Required"
        size="sm"
        pending={loading}
        footer={<><Button variant="ghost" size="sm" onClick={() => { setShowPasswordModal(false); setSudoPassword(""); setModalError(null); }} disabled={loading}>Cancel</Button><Button variant="primary" size="sm" onClick={handleConfirmPassword} loading={loading}>Confirm</Button></>}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-dd border border-dd-warning/30 bg-dd-warning/10 p-3">
            <span className="material-symbols-outlined text-[20px] text-dd-warning" aria-hidden="true">warning</span>
            <p className="text-xs text-dd-muted">Required to modify /etc/hosts and flush DNS cache</p>
          </div>
          <Input
            label="Sudo password"
            type="password"
            placeholder="Enter sudo password"
            value={sudoPassword}
            onChange={(event) => setSudoPassword(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !loading) handleConfirmPassword(); }}
            autoFocus
          />
          {modalError ? (
            <div className="flex items-center gap-2 rounded-dd bg-dd-danger/10 px-2 py-1.5 text-xs text-dd-danger">
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">error</span>
              <span>{modalError}</span>
            </div>
          ) : null}
        </div>
      </Modal>

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleModelSelect}
        selectedModel={currentEditingAlias ? getMappingEntry(currentEditingAlias).model || null : null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={`Select model for ${currentEditingAlias}`}
      />
    </>
  );
}
