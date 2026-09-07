"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/shared/ui/components/Card";
import Button from "@/shared/ui/components/Button";
import { Badge } from "@/shared/ui/components/Badge";
import Input from "@/shared/ui/components/Input";
import Modal from "@/shared/ui/components/Modal";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

/**
 * Shared MITM infrastructure card — manages SSL cert + server start/stop.
 * DNS per-tool is handled separately in MitmToolCard.
 */
export default function MitmServerCard({ apiKeys, cloudEnabled, onStatusChange }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [modalError, setModalError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [mitmRouterBaseUrl, setMitmRouterBaseUrl] = useState(DEFAULT_MITM_ROUTER_BASE);
  const [port443Conflict, setPort443Conflict] = useState(null);

  const serverIsWindows = status?.isWin === true;
  const canRunWithoutPassword = serverIsWindows || status?.hasCachedPassword || status?.needsSudoPassword === false;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.mitmRouterBaseUrl) {
          setMitmRouterBaseUrl(data.mitmRouterBaseUrl);
        }
        onStatusChange?.(data);
      }
    } catch {
      setStatus({ running: false, certExists: false, dnsStatus: {} });
    }
  }, [onStatusChange]);

  useEffect(() => {
    queueMicrotask(() => {
      fetchStatus();
    });
  }, [fetchStatus]);

  const handleAction = (action) => {
    setActionError(null);
    // Wait for status to load before deciding whether to show sudo modal
    if (!status) return;
    if (canRunWithoutPassword) {
      doAction(action, "");
    } else {
      setPendingAction(action);
      setShowPasswordModal(true);
      setModalError(null);
    }
  };

  const doAction = async (action, password, forceKillPort443 = false) => {
    setLoading(true);
    setActionError(null);
    try {
      let res;
      if (action === "trust-cert") {
        res = await fetch("/api/cli-tools/antigravity-mitm", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trust-cert", sudoPassword: password }),
        });
      } else if (action === "start") {
        const keyToUse = selectedApiKey?.trim()
          || (!cloudEnabled ? "sk_durindoor" : null);
        res = await fetch("/api/cli-tools/antigravity-mitm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: keyToUse,
            sudoPassword: password,
            mitmRouterBaseUrl: mitmRouterBaseUrl.trim() || DEFAULT_MITM_ROUTER_BASE,
            forceKillPort443,
          }),
        });
      } else {
        res = await fetch("/api/cli-tools/antigravity-mitm", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sudoPassword: password }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "PORT_443_BUSY" && data.portOwner) {
          setShowPasswordModal(false);
          setPort443Conflict({ owner: data.portOwner, password });
          return;
        }
        setActionError(data.error || `Failed to ${action} MITM server`);
        return;
      }
      setShowPasswordModal(false);
      setSudoPassword("");
      setPort443Conflict(null);
      await fetchStatus();
    } catch (e) {
      setActionError(e.message || "Network error");
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  const handleKillAndStart = () => {
    const pwd = port443Conflict?.password || "";
    doAction("start", pwd, true);
  };

  const handleConfirmPassword = () => {
    if (!sudoPassword.trim()) {
      setModalError("Sudo password is required");
      return;
    }
    doAction(pendingAction, sudoPassword);
  };

  const isRunning = status?.running;

  return (
    <>
      <Card padding={false} className="border-dd-accent/20 bg-dd-accent-soft p-4">
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-dd-accent text-[20px]">security</span>
              <span className="font-semibold text-sm text-dd-text">MITM Server</span>
              {isRunning ? (
                <Badge tone="success" size="sm">Running</Badge>
              ) : (
                <Badge tone="neutral" size="sm">Stopped</Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1 text-xs text-dd-muted" data-i18n-skip="true">
              {[
                { label: "Cert", ok: status?.certExists },
                { label: "Trusted", ok: status?.certTrusted },
                { label: "Server", ok: isRunning },
              ].map(({ label, ok }) => (
                <span key={label} className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-dd ${ok ? "text-dd-success" : "text-dd-muted"}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[12px]">
                    {ok ? "check_circle" : "cancel"}
                  </span>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Purpose & How it works */}
          <div className="px-2 py-2 rounded-dd-lg bg-dd-surface/50 border border-dd-border/50 flex flex-col gap-2">
            <p className="text-[11px] text-dd-muted leading-relaxed">
              <span className="font-medium text-dd-text">Purpose:</span> Use Antigravity IDE & GitHub Copilot → with ANY provider/model from DurinDoor
            </p>
            <p className="text-[11px] text-dd-muted leading-relaxed">
              <span className="font-medium text-dd-text">How it works:</span> Antigravity/Copilot IDE request → DNS redirect to localhost:443 → MITM proxy intercepts → DurinDoor → response to Antigravity/Copilot
            </p>
          </div>

          {/* Base URL + API Key — same row pattern as Claude Code / cli-tools */}
          <div className="flex flex-col gap-2">
            <div className="grid gap-1 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
              <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">DurinDoor Base URL</span>
              <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
              <input
                type="text"
                value={mitmRouterBaseUrl}
                onChange={(e) => setMitmRouterBaseUrl(e.target.value)}
                placeholder={DEFAULT_MITM_ROUTER_BASE}
                disabled={isRunning}
                className="flex-1 min-w-0 px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border text-xs text-dd-text focus:outline-none focus:ring-1 focus-visible:shadow-dd-focus disabled:opacity-50"
              />
            </div>
            {!isRunning && (
              <div className="grid gap-1 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                <span className="text-xs font-semibold text-dd-text sm:text-right sm:text-sm">API Key</span>
                <span aria-hidden="true" className="material-symbols-outlined hidden text-dd-muted text-[14px] sm:inline">arrow_forward</span>
                <input
                  type="password"
                  value={selectedApiKey}
                  onChange={(e) => setSelectedApiKey(e.target.value)}
                  autoComplete="off"
                  placeholder={cloudEnabled ? "Paste the API key secret" : "sk_durindoor (default)"}
                  className="flex-1 min-w-0 px-2 py-1.5 bg-dd-surface rounded-dd border border-dd-border text-xs text-dd-text focus:outline-none focus:ring-1 focus-visible:shadow-dd-focus"
                />
                {apiKeys?.length > 0 && (
                  <span className="text-[11px] text-dd-muted sm:col-start-3">
                    Managed keys: {apiKeys.map((key) => `${key.name || "Key"} (${key.maskedKey || "***"})`).join(", ")}. Paste a saved secret to use one.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" data-i18n-skip="true">
            {status?.certExists && !status?.certTrusted && (
              <Button
                onClick={() => handleAction("trust-cert")}
                disabled={loading}
                className="flex w-full items-center justify-center gap-1.5 rounded-dd-lg border border-dd-warning/30 bg-dd-warning/10 px-4 py-2 text-xs font-medium text-dd-warning transition-colors hover:bg-dd-warning/20 disabled:opacity-50 sm:w-auto sm:py-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">verified_user</span>
                Trust Cert
              </Button>
            )}
            {isRunning ? (
              <Button
                onClick={() => handleAction("stop")}
                disabled={loading}
                className="flex w-full items-center justify-center gap-1.5 rounded-dd-lg border border-dd-danger/30 bg-dd-danger/10 px-4 py-2 text-xs font-medium text-dd-danger transition-colors hover:bg-dd-danger/20 disabled:opacity-50 sm:w-auto sm:py-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">stop_circle</span>
                Stop Server
              </Button>
            ) : (
              <Button
                onClick={() => handleAction("start")}
                disabled={loading || !status || (serverIsWindows && status?.isAdmin === true)}
                title={serverIsWindows && status?.isAdmin === true ? "Restart DurinDoor as a standard user" : undefined}
                className="flex w-full items-center justify-center gap-1.5 rounded-dd-lg border border-dd-accent/30 bg-dd-accent-soft px-4 py-2 text-xs font-medium text-dd-accent transition-colors hover:bg-dd-accent-soft disabled:opacity-50 sm:w-auto sm:py-1.5"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">play_circle</span>
                Start Server
              </Button>
            )}
            {isRunning && (
              <p className="text-xs text-dd-muted">Enable DNS per tool below to activate interception</p>
            )}
          </div>

          {/* Action error */}
          {actionError && (
            <div className="flex items-start gap-2 px-2 py-1.5 rounded-dd text-xs bg-dd-danger/10 text-dd-danger border border-dd-danger/20">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">error</span>
              <span>{actionError}</span>
            </div>
          )}

          {/* Windows privilege boundary */}
          {serverIsWindows && status?.isAdmin === true && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs bg-dd-danger/10 text-dd-danger border border-dd-danger/20">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">shield_lock</span>
              <span>Restart DurinDoor as a standard user. Only the firewall, certificate, and hosts changes request UAC.</span>
            </div>
          )}
          {serverIsWindows && status?.isAdmin === false && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-dd text-xs bg-dd-warning/10 text-dd-warning border border-dd-warning/20">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">verified_user</span>
              <span>The proxy stays unprivileged; Windows may show narrow UAC prompts for system configuration.</span>
            </div>
          )}
        </div>
      </Card>

      {/* Password Modal */}
      <Modal
        open={showPasswordModal}
        onClose={() => { if (!loading) { setShowPasswordModal(false); setSudoPassword(""); setModalError(null); } }}
        title="Sudo Password Required"
        size="sm"
        pending={loading}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-dd-lg border border-dd-warning/30 bg-dd-warning/10 p-3">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-dd-warning">warning</span>
            <p className="text-xs text-dd-muted">Required for SSL certificate and server startup</p>
          </div>
          <Input
            type="password"
            placeholder="Enter sudo password"
            value={sudoPassword}
            onChange={(e) => setSudoPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleConfirmPassword(); }}
          />
          {modalError && (
            <div className="flex items-center gap-2 rounded-dd bg-dd-danger/10 px-2 py-1.5 text-xs text-dd-danger">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">error</span>
              <span>{modalError}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setShowPasswordModal(false); setSudoPassword(""); setModalError(null); }} disabled={loading}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleConfirmPassword} loading={loading}>Confirm</Button>
          </div>
        </div>
      </Modal>

      {/* Port 443 Conflict Modal */}
      <Modal
        open={Boolean(port443Conflict)}
        onClose={() => { if (!loading) { setPort443Conflict(null); setLoading(false); } }}
        title="Port 443 Already In Use"
        size="md"
        pending={loading}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-dd-lg border border-dd-warning/30 bg-dd-warning/10 p-3">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-dd-warning">warning</span>
            <div className="flex flex-col gap-1 text-xs text-dd-muted">
              <p>Port 443 is currently used by another process:</p>
              <p className="font-mono text-dd-text" data-i18n-skip="true">{port443Conflict?.owner.name} (PID {port443Conflict?.owner.pid})</p>
              <p>Kill this process to start MITM Server?</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setPort443Conflict(null); setLoading(false); }} disabled={loading}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleKillAndStart} loading={loading}>Kill & Start</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
