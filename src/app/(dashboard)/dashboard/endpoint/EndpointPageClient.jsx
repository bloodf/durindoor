"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  TUNNEL_BENEFITS,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
  getCompositeEndpointEnabled,
  getLocalEndpointUrl,
} from "./endpointConstants";
import { clientPingUrl, clientPingAny } from "./endpointPing";
import EndpointRow from "./components/EndpointRow";
import StatusAlert from "./components/StatusAlert";
import Tooltip from "./components/Tooltip";
import SecurityWarning from "./components/SecurityWarning";
import ApiKeyPolicyFields from "./components/ApiKeyPolicyFields";
import {
  apiKeyPolicyDraftToPayload,
  apiKeyPolicyPatchFromDraft,
  apiKeyPolicyToDraft,
  emptyApiKeyPolicyDraft,
  formatPolicyUsage,
  isEditableApiKeyPolicy,
} from "./apiKeyPolicy";
import {
  API_KEY_EXPIRY_PRESETS,
  expiryFromSelection,
  expirySelectionFromValue,
  formatKeyExpiry,
} from "./apiKeyExpiry";
import { isBrowser } from "../../../../shared/utils/typeChecks.js";

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-dd-lg border border-dd-border bg-dd-surface p-5" aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className="block size-8 rounded-dd bg-dd-surface-2" />
        <span className="block h-4 w-40 rounded-dd bg-dd-surface-2" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="block h-9 rounded-dd bg-dd-surface-2" />
        <span className="block h-9 rounded-dd bg-dd-surface-2" />
      </div>
    </div>
  );
}

const TUNNEL_LABEL_TONE = "accent";
const TUNNEL_LABEL_IDLE = "neutral";
const TS_LABEL_TONE = "accent";
const TS_LABEL_IDLE = "neutral";

function RowLabel({ children, tone }) {
  return (
    <Badge tone={tone} size="sm" className="w-fit shrink-0 sm:min-w-[88px] sm:justify-center">
      {children}
    </Badge>
  );
}

function StatePill({ tone, icon, spin = false, children }) {
  return (
    <div
      className={`flex flex-1 items-center gap-2 rounded-dd border px-3 py-1.5 text-[13px] ${
        tone === "warning"
          ? "border-dd-warning bg-dd-warning/10 text-dd-warning"
          : tone === "danger"
          ? "border-dd-danger bg-dd-danger/10 text-dd-danger"
          : tone === "accent"
          ? "border-dd-accent bg-dd-accent-soft text-dd-accent"
          : "border-dd-border bg-dd-surface-2 text-dd-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined text-[16px] leading-none${spin ? " animate-spin" : ""}`}
      >
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </div>
  );
}

function ApiKeyRow({ apiKey, onToggle, onReveal, onEdit, onDelete, copied, policyInvalid, policyUsage }) {
  const active = apiKey.isActive ?? true;
  const expiry = formatKeyExpiry(apiKey.expiresAt);
  const overflowReached = policyUsage.tokensExceeded || policyUsage.costExceeded;
  return (
    <div
      className={`group flex flex-col gap-3 rounded-dd-lg px-3 py-3 transition-colors hover:bg-dd-surface-2 sm:flex-row sm:items-start ${
        active ? "" : "opacity-60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-dd-text">{apiKey.name}</p>
          <Badge tone={active ? "success" : "warning"} size="sm">
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className={`block size-1.5 rounded-full ${active ? "bg-dd-success" : "bg-dd-warning"}`} />
              {active ? "Active" : "Paused"}
            </span>
          </Badge>
        </div>
        <code className="mt-1 block font-mono text-xs text-dd-muted">{apiKey.maskedKey || "***"}</code>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-dd bg-dd-surface-2 px-1.5 py-0.5 text-dd-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">schedule</span>
            Created {new Date(apiKey.createdAt).toLocaleDateString()}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-dd px-1.5 py-0.5 ${
              expiry.danger
                ? "border border-dd-danger/30 bg-dd-danger/10 text-dd-danger"
                : "bg-dd-surface-2 text-dd-muted"
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">event</span>
            {expiry.text}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-dd px-1.5 py-0.5 ${
              policyInvalid || overflowReached
                ? "border border-dd-danger/30 bg-dd-danger/10 text-dd-danger"
                : "bg-dd-surface-2 text-dd-muted"
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">tune</span>
            {policyInvalid
              ? "Invalid policy"
              : `Models: ${apiKey.policy?.allowedModels?.length ? apiKey.policy.allowedModels.length : "All"}`}
          </span>
          <span className="inline-flex items-center gap-1 rounded-dd bg-dd-surface-2 px-1.5 py-0.5 text-dd-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">data_usage</span>
            <span className="dd-tnum">{policyUsage.tokens} tok · {policyUsage.cost}</span>
            {overflowReached ? " · limit reached" : ""}
          </span>
          <span className="inline-flex items-center gap-1 rounded-dd bg-dd-surface-2 px-1.5 py-0.5 text-dd-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">speed</span>
            {apiKey.dailyLimitTokens == null ? "No daily limit" : `${apiKey.dailyLimitTokens.toLocaleString()}/day`}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-dd-muted">Combos:</span>
          {Array.isArray(apiKey.allowedCombos) && apiKey.allowedCombos.length > 0 ? (
            apiKey.allowedCombos.map((c) => (
              <span
                key={c}
                className="rounded-dd bg-dd-accent-soft px-1.5 py-0.5 text-[11px] text-dd-accent"
              >
                {c}
              </span>
            ))
          ) : (
            <span className="rounded-dd bg-dd-accent-soft px-1.5 py-0.5 text-[11px] text-dd-accent">All</span>
          )}
        </div>
      </div>
      <div className="flex w-full shrink-0 justify-end gap-1 sm:w-auto">
        <Toggle
          size="sm"
          checked={active}
          onChange={(checked) => onToggle(apiKey, checked)}
          aria-label={active ? `Pause ${apiKey.name}` : `Resume ${apiKey.name}`}
        />
        <IconButton
          icon={copied === `reveal_${apiKey.id}` ? "check" : "content_copy"}
          label={`Reveal and copy ${apiKey.name}`}
          variant="ghost"
          size="md"
          className={`opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ${
            copied === `reveal_${apiKey.id}` ? "text-dd-success" : ""
          }`}
          onClick={() => onReveal(apiKey.id)}
        />
        <IconButton
          icon="edit"
          label={`Edit ${apiKey.name}`}
          variant="ghost"
          size="md"
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => onEdit(apiKey)}
        />
        <IconButton
          icon="delete"
          label={`Delete ${apiKey.name}`}
          variant="ghost"
          size="md"
          className="text-dd-danger opacity-100 hover:bg-dd-danger/10 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => onDelete(apiKey.id)}
        />
      </div>
    </div>
  );
}

ApiKeyRow.propTypes = {
  apiKey: PropTypes.object.isRequired,
  onToggle: PropTypes.func.isRequired,
  onReveal: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  copied: PropTypes.string,
  policyInvalid: PropTypes.bool,
  policyUsage: PropTypes['shape']({ tokens: PropTypes.string, cost: PropTypes.string, tokensExceeded: PropTypes.bool, costExceeded: PropTypes.bool }),
};

function emptyAddKeyPolicy() {
  return emptyApiKeyPolicyDraft();
}

export default function APIPageClient({ machineId, localPort = 20128 }) {
  const [keys, setKeys] = useState([]);
  const [providerConnections, setProviderConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyDailyLimitTokens, setNewKeyDailyLimitTokens] = useState("");
  const [newKeyExpiryPreset, setNewKeyExpiryPreset] = useState("never");
  const [newKeyCustomExpiresAt, setNewKeyCustomExpiresAt] = useState("");
  const [keyStatus, setKeyStatus] = useState(null);
  const [createdKey, setCreatedKey] = useState(null);
  const [createdKeyExpiresAt, setCreatedKeyExpiresAt] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [combos, setCombos] = useState([]);
  const [newKeyAllowedCombos, setNewKeyAllowedCombos] = useState([]);
  const [policyCatalog, setPolicyCatalog] = useState([]);
  const [policyCatalogLoading, setPolicyCatalogLoading] = useState(true);
  const [newKeyPolicy, setNewKeyPolicy] = useState(emptyAddKeyPolicy);
  const [newKeyProviderConnectionIds, setNewKeyProviderConnectionIds] = useState([]);
  const [editKey, setEditKey] = useState(null);
  const [editKeyAllowedCombos, setEditKeyAllowedCombos] = useState([]);
  const [editKeyExpiryPreset, setEditKeyExpiryPreset] = useState("never");
  const [editKeyDailyLimitTokens, setEditKeyDailyLimitTokens] = useState("");
  const [editKeyCustomExpiresAt, setEditKeyCustomExpiresAt] = useState("");
  const [editKeyStatus, setEditKeyStatus] = useState(null);
  const [editKeyPolicy, setEditKeyPolicy] = useState(emptyAddKeyPolicy);
  const [editKeyProviderConnectionIds, setEditKeyProviderConnectionIds] = useState([]);
  const [tunnelExternal, setTunnelExternal] = useState(null);
  const [tsExternal, setTsExternal] = useState(null);
  const [editKeyPolicyDirty, setEditKeyPolicyDirty] = useState(false);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);

  // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelAllUrls, setTunnelAllUrls] = useState([]);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

  // Tailscale state
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState(null);
  const [tsAuthUrl, setTsAuthUrl] = useState("");
  const [tsAuthLabel, setTsAuthLabel] = useState("");
  const [tsInstalled, setTsInstalled] = useState(null);
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef(null);

  const tunnelMissRef = useRef(0);
  const tsMissRef = useRef(0);
  const tunnelClientReachableRef = useRef(false);
  const tsClientReachableRef = useRef(false);
  const tunnelEverReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);

  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (isBrowser()) setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  const { copied, copy } = useCopyToClipboard();

  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    fetchData();
    fetchPolicyCatalog();
    loadSettings();
  }, []);

  useEffect(() => {
    const anyEnabled = tunnelEnabled || tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tsEnabled, tunnelReachable, tsReachable]);

  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) {
          tunnelMissRef.current = 0;
          setTunnelReachable(true);
          if (!tunnelEverReachableRef.current) {
            tunnelEverReachableRef.current = true;
            setTunnelEverReachable(true);
          }
        } else {
          tunnelMissRef.current += 1;
          if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false);
        }
      } else {
        tunnelClientReachableRef.current = false;
      }
      if (tsEnabled && tsUrl) {
        const ok = await clientPingUrl(tsUrl);
        tsClientReachableRef.current = ok;
        if (ok) {
          tsMissRef.current = 0;
          setTsReachable(true);
          if (!tsEverReachableRef.current) {
            tsEverReachableRef.current = true;
            setTsEverReachable(true);
          }
        } else {
          tsMissRef.current += 1;
          if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false);
        }
      } else {
        tsClientReachableRef.current = false;
      }
    };
    const anyEnabled = (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) || (tsEnabled && tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    const tsHealthy = !tsEnabled || tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tsEnabled, tsUrl, tunnelReachable, tsReachable]);

  const updateReachable = useCallback((_unused, clientRef, missRef, setter, everRef, everSetter) => {
    const reachable = clientRef.current;
    if (reachable) {
      missRef.current = 0;
      setter(true);
      if (!everRef.current) {
        everRef.current = true;
        everSetter(true);
      }
    } else {
      missRef.current += 1;
      if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
    }
  }, []);

  const syncTunnelStatus = async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return;
      const data = await statusRes.json();
      const tEnabled = getCompositeEndpointEnabled(data.tunnel);
      const tUrl = data.tunnel?.tunnelUrl || "";
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || "");
      setTunnelAllUrls(Array.isArray(data.tunnel?.allUrls) ? data.tunnel?.allUrls : []);
      setTunnelEnabled(tEnabled);
      setTunnelExternal(data.tunnel?.externalTunnel || null);
      updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

      const tsEn = getCompositeEndpointEnabled(data.tailscale);
      const tsUrlVal = data.tailscale?.tunnelUrl || "";
      setTsUrl(tsUrlVal);
      setTsEnabled(tsEn);
      setTsExternal(data.tailscale?.systemTailscale || null);
      updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
    } catch { /* ignore poll errors */ }
  };

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/tunnel/status", { cache: "no-store" }),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRequireApiKey(data.requireApiKey || false);
        setRequireLogin(data.requireLogin !== false);
        setHasPassword(data.hasPassword || false);
        setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
      }
      if (statusRes.ok) {
        const data = await statusRes.json();
        const tEnabled = getCompositeEndpointEnabled(data.tunnel);
        const tUrl = data.tunnel?.tunnelUrl || "";
        setTunnelUrl(tUrl);
        setTunnelPublicUrl(data.tunnel?.publicUrl || "");
        setTunnelAllUrls(Array.isArray(data.tunnel?.allUrls) ? data.tunnel?.allUrls : []);
        setTunnelEnabled(tEnabled);
        setTunnelExternal(data.tunnel?.externalTunnel || null);
        updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

        const tsEn = getCompositeEndpointEnabled(data.tailscale);
        const tsUrlVal = data.tailscale?.tunnelUrl || "";
        setTsUrl(tsUrlVal);
        setTsEnabled(tsEn);
        setTsExternal(data.tailscale?.systemTailscale || null);
        updateReachable(null, tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
      }
    } catch (error) {
      console.log("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) setTunnelDashboardAccess(value);
    } catch (error) {
      console.log("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const fetchData = async () => {
    setLoadError("");
    try {
      const [keysRes, combosRes] = await Promise.all([
        fetch("/api/keys"),
        fetch("/api/combos"),
      ]);
      const keysData = await keysRes.json();
      if (keysRes.ok) {
        setProviderConnections(keysData.providerConnections || []);
        setKeys(keysData.keys || []);
      } else {
        setLoadError(keysData.error || `API key request failed (${keysRes.status})`);
      }
      if (combosRes.ok) {
        const combosData = await combosRes.json();
        setCombos(combosData.combos || combosData || []);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
      setLoadError(error.message || "Unable to load API keys");
    } finally {
      setLoading(false);
    }
  };

  async function fetchPolicyCatalog() {
    try {
      const response = await fetch("/api/keys/policy-catalog");
      if (response.ok) {
        const data = await response.json();
        setPolicyCatalog(data.models || []);
      }
    } catch (error) {
      console.log("Error fetching API-key policy catalog:", error);
    } finally {
      setPolicyCatalogLoading(false);
    }
  }

  const pingTunnelHealth = async (...urls) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: "cors", cache: "no-store" });
        if (p.ok) return true;
        throw new Error("not ready");
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
              setTunnelLoading(false);
              setTunnelProgress("");
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: "error", message: "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              setTunnelProgress(`Downloading cloudflared... ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      const data = await res.json();
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
        return;
      }

      const url = data.tunnelUrl;
      if (!url) {
        setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
        return;
      }

      setTunnelUrl(url);
      setTunnelPublicUrl(data.publicUrl || "");
      await pingTunnelHealth(data.publicUrl, url);
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: data.error || "Install failed" });
          }
        }
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsInstalling(false);
    }
  };

  const pingTsHealth = async (url) => {
    setTsProgress("Waiting for Tailscale ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  const requestUserAuth = (url, label) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };

  const clearUserAuth = () => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  };

  const handleConnectTailscale = async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress("Connecting...");
    clearUserAuth();
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: "warning", message: "Connected but not reachable yet." });
        return;
      }

      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, "Open Login Page");
        setTsProgress("Login required — click \"Open Login Page\" to continue");
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                clearUserAuth();
                setTsProgress("Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: "warning", message: "Connected but not reachable yet." });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl);
                } else {
                  setTsStatus({ type: "error", message: data2.error || "Failed to start funnel" });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        clearUserAuth();
        setTsStatus({ type: "error", message: "Login timed out. Please try again." });
        return;
      }

      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl);
        return;
      }

      setTsStatus({ type: "error", message: data.error || "Failed to connect" });
    } catch (error) {
      setTsStatus({ type: "error", message: error.message });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
      clearUserAuth();
    }
  };

  const pollFunnelEnable = async (enableUrl) => {
    requestUserAuth(enableUrl, "Open Funnel Settings");
    setTsProgress("Click \"Open Funnel Settings\" to enable Funnel...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          clearUserAuth();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          setTsEnabled(true);
          setTsStatus(ok3 ? null : { type: "warning", message: "Connected but not reachable yet." });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: "Timed out waiting for Funnel to be enabled." });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: data.error || "Failed to disable Tailscale" });
      }
    } catch (e) {
      setTsStatus({ type: "error", message: e.message });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const dailyLimitTokens = newKeyDailyLimitTokens.trim() === "" ? null : Number(newKeyDailyLimitTokens);
      if (dailyLimitTokens !== null && (!Number.isSafeInteger(dailyLimitTokens) || dailyLimitTokens < 0)) return;

      let expiresAt;
      let policy;
      try {
        expiresAt = expiryFromSelection(newKeyExpiryPreset, newKeyCustomExpiresAt);
        policy = apiKeyPolicyDraftToPayload(newKeyPolicy);
      } catch (error) {
        setKeyStatus({ type: "error", message: error.message });
        return;
      }

      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, allowedCombos: newKeyAllowedCombos, dailyLimitTokens, expiresAt, policy, providerConnectionIds: newKeyProviderConnectionIds }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        setCreatedKeyExpiresAt(data.expiresAt || null);
        await fetchData();
        setNewKeyName("");
        setNewKeyDailyLimitTokens("");
        setNewKeyExpiryPreset("never");
        setNewKeyCustomExpiresAt("");
        setNewKeyAllowedCombos([]);
        setNewKeyProviderConnectionIds([]);
        setNewKeyPolicy(emptyApiKeyPolicyDraft());
        setKeyStatus(null);
        setShowAddModal(false);
      } else {
        setKeyStatus({ type: "error", message: data.error || "Failed to create key" });
      }
    } catch (error) {
      console.log("Error creating key:", error);
      setKeyStatus({ type: "error", message: "Failed to create key" });
    }
  };

  const revealAndCopyKey = async (id) => {
    try {
      const res = await fetch(`/api/keys/${id}/reveal`);
      const data = await res.json();
      if (res.ok && data.key) {
        copy(data.key, `reveal_${id}`);
      } else {
        setKeyStatus({ type: "error", message: data.error || "Failed to reveal key" });
      }
    } catch {
      setKeyStatus({ type: "error", message: "Failed to reveal key" });
    }
  };

  const handleDeleteKey = (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys(keys.filter((k) => k.id !== id));
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      },
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, isActive } : k)));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const requestToggleKey = (key, checked) => {
    if (key.isActive && !checked) {
      setConfirmState({
        title: "Pause API Key",
        message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
        onConfirm: async () => {
          setConfirmState(null);
          handleToggleKey(key.id, checked);
        },
      });
      return;
    }
    handleToggleKey(key.id, checked);
  };

  const handleUpdateKeyDetails = async (id, allowedCombos, expiresAt, policyPatch, dailyLimitTokens = null, providerConnectionIds) => {
    try {
      const payload = { allowedCombos, expiresAt, dailyLimitTokens, providerConnectionIds };
      if (policyPatch) Object.assign(payload, policyPatch);
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? data.key : k)));
        return true;
      }
      setEditKeyStatus({ type: "error", message: data.error || "Failed to update API key" });
    } catch (error) {
      console.log("Error updating key details:", error);
      setEditKeyStatus({ type: "error", message: "Failed to update API key" });
    }
    return false;
  };

  const handleUpdateKeyLimit = async (id, value) => {
    const dailyLimitTokens = value.trim() === "" ? null : Number(value);
    if (dailyLimitTokens !== null && (!Number.isSafeInteger(dailyLimitTokens) || dailyLimitTokens < 0)) return;
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLimitTokens }),
      });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, dailyLimitTokens } : k)));
      }
    } catch (error) {
      console.log("Error updating key limit:", error);
    }
  };

  const beginEditKey = (key) => {
    const expiry = expirySelectionFromValue(key.expiresAt);
    setEditKey(key);
    setEditKeyAllowedCombos(Array.isArray(key.allowedCombos) ? [...key.allowedCombos] : []);
    setEditKeyProviderConnectionIds(Array.isArray(key.providerConnectionIds) ? [...key.providerConnectionIds] : []);
    setEditKeyExpiryPreset(expiry.selection);
    setEditKeyCustomExpiresAt(expiry.customLocalValue);
    setEditKeyDailyLimitTokens(key.dailyLimitTokens == null ? "" : String(key.dailyLimitTokens));
    setEditKeyPolicy(apiKeyPolicyToDraft(key.policy));
    setEditKeyPolicyDirty(false);
    setEditKeyStatus(null);
  };

  const currentEndpoint = getLocalEndpointUrl(localPort);

  const resetAddModal = () => {
    setShowAddModal(false);
    setNewKeyName("");
    setNewKeyDailyLimitTokens("");
    setNewKeyExpiryPreset("never");
    setNewKeyCustomExpiresAt("");
    setNewKeyAllowedCombos([]);
    setNewKeyPolicy(emptyApiKeyPolicyDraft());
    setNewKeyProviderConnectionIds([]);
    setKeyStatus(null);
  };

  const resetEditModal = () => {
    setEditKey(null);
    setEditKeyAllowedCombos([]);
    setEditKeyExpiryPreset("never");
    setEditKeyCustomExpiresAt("");
    setEditKeyDailyLimitTokens("");
    setEditKeyProviderConnectionIds([]);
    setEditKeyPolicy(emptyApiKeyPolicyDraft());
    setEditKeyPolicyDirty(false);
    setEditKeyStatus(null);
  };

  const expiryOptions = API_KEY_EXPIRY_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }));
  const addKeyProviderOptions = providerConnections
    .filter((connection) => !newKeyProviderConnectionIds.includes(connection.id))
    .map((connection) => ({
      value: connection.id,
      label: `${connection.name || connection.id} (${connection.provider})`,
    }));
  const editKeyProviderOptions = providerConnections
    .filter((connection) => !editKeyProviderConnectionIds.includes(connection.id))
    .map((connection) => ({
      value: connection.id,
      label: `${connection.name || connection.id} (${connection.provider})`,
    }));

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        icon="key"
        title="Endpoint"
        subtitle="API endpoint and key configuration"
      />
      {loadError ? <StatusAlert status={{ type: "error", message: loadError }} /> : null}

      {/* Endpoint Card */}
      <Card padding={false}>
        <CardHeader icon="api" title="API Endpoint" />
        <CardContent>
          <div className="flex flex-col gap-2">
            {/* Local */}
            <EndpointRow
              label="Local"
              url={currentEndpoint}
              copyId="local_url"
              copied={copied}
              onCopy={copy}
            />

            {/* Cloudflare Tunnel */}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <RowLabel tone={tunnelEnabled || tunnelExternal ? TUNNEL_LABEL_TONE : TUNNEL_LABEL_IDLE}>Tunnel</RowLabel>
              {tunnelExternal && !tunnelEnabled ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-dd border border-dd-accent/40 bg-dd-accent-soft px-3 py-1.5 text-[13px] text-dd-accent">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">cloud_done</span>
                  <span className="font-medium">External</span>
                  <Input
                    value={`${tunnelExternal.tunnelUrl}/v1`}
                    readOnly
                    aria-label="External tunnel URL"
                    className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs"
                  />
                  <IconButton
                    icon={copied === "tunnel_url" ? "check" : "content_copy"}
                    label="Copy external tunnel URL"
                    variant="ghost"
                    size="md"
                    onClick={() => copy(`${tunnelExternal.tunnelUrl}/v1`, "tunnel_url")}
                  />
                </div>
              ) : tunnelEnabled && !tunnelLoading && tunnelReachable ? (
                <>
                  <Input
                    value={`${tunnelUrl}/v1`}
                    readOnly
                    aria-label="Cloudflare tunnel URL"
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <IconButton
                    icon={copied === "tunnel_url" ? "check" : "content_copy"}
                    label="Copy Cloudflare tunnel URL"
                    variant="ghost"
                    size="md"
                    onClick={() => copy(`${tunnelUrl}/v1`, "tunnel_url")}
                  />
                  <IconButton
                    icon="power_settings_new"
                    label="Disable Cloudflare tunnel"
                    variant="ghost"
                    size="md"
                    className="text-dd-danger hover:bg-dd-danger/10"
                    onClick={() => setShowDisableTunnelModal(true)}
                  />
                </>
              ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
                <>
                  <StatePill tone="warning" icon="progress_activity" spin>
                    {tunnelEverReachable ? "Tunnel reconnecting..." : "Tunnel checking..."}
                  </StatePill>
                  <IconButton
                    icon="power_settings_new"
                    label="Disable Cloudflare tunnel"
                    variant="ghost"
                    size="md"
                    className="text-dd-danger hover:bg-dd-danger/10"
                    onClick={() => setShowDisableTunnelModal(true)}
                  />
                </>
              ) : tunnelLoading ? (
                <>
                  <StatePill tone="neutral" icon="progress_activity" spin>
                    {tunnelProgress || "Creating tunnel..."}
                  </StatePill>
                  <IconButton
                    icon="power_settings_new"
                    label="Stop creating tunnel"
                    variant="ghost"
                    size="md"
                    className="text-dd-danger hover:bg-dd-danger/10"
                    onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                  />
                </>
              ) : tunnelStatus?.type === "error" ? (
                <>
                  <StatePill tone="danger" icon="error">{tunnelStatus.message}</StatePill>
                  <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
                </>
              ) : tunnelChecking ? (
                <>
                  <StatePill tone="neutral" icon="progress_activity" spin>Checking...</StatePill>
                  <IconButton
                    icon="power_settings_new"
                    label="Stop tunnel check"
                    variant="ghost"
                    size="md"
                    className="text-dd-danger hover:bg-dd-danger/10"
                    onClick={() => setTunnelChecking(false)}
                  />
                </>
              ) : (
                <Button
                  size="sm"
                  icon="cloud_upload"
                  onClick={() => {
                    if (isLoginUnsafe) {
                      setTunnelStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                      return;
                    }
                    if (!requireApiKey) {
                      setTunnelStatus({ type: "error", message: "Security required: Enable \"Require API key\" before activating the tunnel." });
                      return;
                    }
                    setShowEnableTunnelModal(true);
                  }}
                >
                  Enable
                </Button>
              )}
            </div>

            {/* Tailscale */}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <RowLabel tone={tsEnabled || tsExternal ? TS_LABEL_TONE : TS_LABEL_IDLE}>Tailscale</RowLabel>
              {tsExternal?.tunnelUrl && !tsEnabled ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-dd border border-dd-accent/40 bg-dd-accent-soft px-3 py-1.5 text-[13px] text-dd-accent">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">vpn_lock</span>
                  <span className="font-medium">External</span>
                  <Input
                    value={`${tsExternal.tunnelUrl}/v1`}
                    readOnly
                    aria-label="External Tailscale URL"
                    className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs"
                  />
                  <IconButton
                    icon={copied === "ts_url" ? "check" : "content_copy"}
                    label="Copy external Tailscale URL"
                    variant="ghost"
                    size="md"
                    onClick={() => copy(`${tsExternal.tunnelUrl}/v1`, "ts_url")}
                  />
                </div>
              ) : tsEnabled && !tsLoading && tsReachable ? (
                <>
                  <Input
                    value={`${tsUrl}/v1`}
                    readOnly
                    aria-label="Tailscale URL"
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <IconButton
                    icon={copied === "ts_url" ? "check" : "content_copy"}
                    label="Copy Tailscale URL"
                    variant="ghost"
                    size="md"
                    onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                  />
                  <IconButton
                    icon="power_settings_new"
                    label="Disable Tailscale"
                    variant="ghost"
                    size="md"
                    className="text-dd-danger hover:bg-dd-danger/10"
                    onClick={() => setShowDisableTsModal(true)}
                  />
                </>
              ) : tsEnabled && !tsLoading && !tsReachable ? (
                <>
                  <StatePill tone="warning" icon="progress_activity" spin>
                    {tsEverReachable ? "Tailscale reconnecting..." : "Tailscale checking..."}
                  </StatePill>
                  <IconButton
                    icon="power_settings_new"
                    label="Disable Tailscale"
                    variant="ghost"
                    size="md"
                    className="text-dd-danger hover:bg-dd-danger/10"
                    onClick={() => setShowDisableTsModal(true)}
                  />
                </>
              ) : tsLoading || tsConnecting ? (
                <>
                  <StatePill tone="neutral" icon="progress_activity" spin>
                    {tsProgress || "Connecting..."}
                  </StatePill>
                  {tsAuthUrl ? (
                    <Button
                      size="sm"
                      icon="open_in_new"
                      onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
                    >
                      {tsAuthLabel || "Open"}
                    </Button>
                  ) : null}
                  <IconButton
                    icon="power_settings_new"
                    label="Stop Tailscale setup"
                    variant="ghost"
                    size="md"
                    className="text-dd-danger hover:bg-dd-danger/10"
                    onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(""); clearUserAuth(); }}
                  />
                </>
              ) : tsStatus?.type === "error" ? (
                <>
                  <StatePill tone="danger" icon="error">{tsStatus.message}</StatePill>
                  <Button size="sm" icon="vpn_lock" onClick={handleOpenTsModal}>Enable</Button>
                </>
              ) : (
                <Button
                  size="sm"
                  icon="vpn_lock"
                  onClick={() => {
                    if (isLoginUnsafe) {
                      setTsStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                      return;
                    }
                    handleOpenTsModal();
                  }}
                >
                  Enable
                </Button>
              )}
            </div>

            {tunnelAllUrls.length > 1 ? (
              <div className="mt-1 flex flex-col gap-1.5 rounded-dd-lg border border-dd-border bg-dd-surface-2/50 p-2">
                <p className="px-1 text-xs font-medium text-dd-muted">All Cloudflare endpoints</p>
                {tunnelAllUrls.map((u) => (
                  <div key={u} className="flex items-center gap-2 rounded-dd bg-dd-surface px-2 py-1 text-[13px]">
                    <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[16px] leading-none text-dd-muted">link</span>
                    <Input
                      value={`${u}/v1`}
                      readOnly
                      aria-label={`Cloudflare endpoint ${u}`}
                      className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs"
                    />
                    <IconButton
                      icon={copied === `all_${u}` ? "check" : "content_copy"}
                      label={`Copy Cloudflare endpoint ${u}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => copy(`${u}/v1`, `all_${u}`)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {isLoginUnsafe && !tunnelEnabled && !tsEnabled ? (
            <div className="mt-4">
              <SecurityWarning
                message={unsafeReason}
                action={{ label: "Open settings", href: "/dashboard/profile" }}
              />
            </div>
          ) : null}

          {(tunnelEnabled || tsEnabled) ? (
            <div className="mt-4 flex flex-col gap-2">
              {!requireApiKey ? (
                <SecurityWarning
                  message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                  action={{ label: "Enable", href: "#require-api-key" }}
                />
              ) : null}
              {(!requireLogin || !hasPassword) ? (
                <SecurityWarning
                  message={
                    !requireLogin
                      ? "Require login is disabled — anyone can access your dashboard via tunnel."
                      : "Dashboard uses the default password — change it in Profile settings."
                  }
                  action={{
                    label: !requireLogin ? "Enable" : "Change password",
                    href: "/dashboard/profile",
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {(tunnelEnabled || tsEnabled) ? (
            <div className="mt-4 flex items-center gap-3 border-t border-dd-border-subtle pt-4">
              <Toggle
                checked={tunnelDashboardAccess}
                onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
                label="Allow dashboard access via tunnel"
                description="When enabled, the dashboard can be reached through tunnel/Tailscale URL with login still required."
              />
              <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card id="require-api-key" padding={false}>
        <CardHeader
          icon="vpn_key"
          title="API Keys"
          actions={
            keys.length > 0 ? (
              <Button icon="add" onClick={() => setShowAddModal(true)}>Create Key</Button>
            ) : null
          }
        />
        <CardContent>
          <div className="mb-4 flex items-center justify-between rounded-dd-lg border border-dd-border-subtle pb-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-[13px] font-semibold text-dd-text">Require API key</p>
              <p className="text-xs text-dd-muted">Requests without a valid key will be rejected</p>
            </div>
            <Toggle
              checked={requireApiKey}
              onChange={() => handleRequireApiKey(!requireApiKey)}
              aria-label="Require API key"
            />
          </div>


          {isRemoteHost && !requireApiKey ? (
            <div className="mb-4 -mt-2">
              <SecurityWarning message="Endpoint is exposed without an API key." />
            </div>
          ) : null}

          {keys.length === 0 ? (
            <EmptyState
              icon="vpn_key"
              title="No API keys yet"
              message="Create your first API key to get started."
              action={{ label: "Create Key", icon: "add", onClick: () => setShowAddModal(true) }}
            />
          ) : (
            <ul className="flex flex-col">
              {keys.map((key) => {
                const policyUsage = formatPolicyUsage(key.usage, key.policy);
                const policyInvalid = !isEditableApiKeyPolicy(key.policy);
                return (
                  <li key={key.id}>
                    <ApiKeyRow
                      apiKey={key}
                      onToggle={requestToggleKey}
                      onReveal={revealAndCopyKey}
                      onEdit={beginEditKey}
                      onDelete={handleDeleteKey}
                      copied={copied}
                      policyInvalid={policyInvalid}
                      policyUsage={policyUsage}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add Key Modal */}
      <Modal
        open={showAddModal}
        title="Create API Key"
        size="lg"
        onClose={resetAddModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
            required
          />
          <Input
            label="Daily token limit"
            type="number"
            min="0"
            step="1"
            value={newKeyDailyLimitTokens}
            onChange={(e) => setNewKeyDailyLimitTokens(e.target.value)}
            placeholder="Unlimited"
          />
          <Field label="Expiry">
            <Select
              value={newKeyExpiryPreset}
              onChange={(value) => { setNewKeyExpiryPreset(value); setKeyStatus(null); }}
              options={expiryOptions}
              aria-label="Expiry preset"
            />
          </Field>
          {newKeyExpiryPreset === "custom" ? (
            <Input
              label="Custom expiry (local time)"
              type="datetime-local"
              value={newKeyCustomExpiresAt}
              onChange={(event) => { setNewKeyCustomExpiresAt(event.target.value); setKeyStatus(null); }}
            />
          ) : null}
          {combos.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <p className="text-[13px] font-semibold text-dd-text">Allowed Combos</p>
                <p className="text-xs text-dd-muted">Choose &quot;All combos&quot; for unrestricted access, or select specific combos to restrict this key.</p>
              </div>
              <div tabIndex={0} aria-label="Allowed combos for new key" className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-dd-lg border border-dd-border p-2" role="region">
                <Checkbox
                  checked={newKeyAllowedCombos.length === 0}
                  onChange={() => setNewKeyAllowedCombos([])}
                  label="All combos"
                />
                {combos.map((combo) => (
                  <Checkbox
                    key={combo.id || combo.name}
                    checked={newKeyAllowedCombos.includes(combo.name)}
                    onChange={() => {
                      setNewKeyAllowedCombos((prev) =>
                        prev.includes(combo.name)
                          ? prev.filter((c) => c !== combo.name)
                          : [...prev, combo.name]
                      );
                    }}
                    label={combo.name}
                    hint={combo.kind}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <Field label="Provider accounts" hint="Leave empty for unrestricted access.">
            <Select
              value=""
              placeholder="Add provider account"
              options={addKeyProviderOptions}
              onChange={(value) =>
                value
                  ? setNewKeyProviderConnectionIds((prev) => (prev.includes(value) ? prev : [...prev, value]))
                  : undefined
              }
            />
          </Field>
          <DataTable
            ariaLabel="Scoped provider accounts for the new key"
            columns={[
              { key: "name", label: "Name" },
              { key: "provider", label: "Provider" },
              {
                key: "remove",
                label: "Actions",
                align: "right",
                render: (row) => (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setNewKeyProviderConnectionIds((prev) => prev.filter((id) => id !== row.id))
                    }
                  >
                    Remove
                  </Button>
                ),
              },
            ]}
            rows={newKeyProviderConnectionIds.map((id) => {
              const connection = providerConnections.find((item) => item.id === id) || { id, name: id, provider: "unknown" };
              return { id, name: connection.name || id, provider: connection.provider };
            })}
            keyFn={(row) => row.id}
            density="compact"
            emptyState={{ title: "No scoped accounts", message: "This key can route through every provider account." }}
          />
          <ApiKeyPolicyFields
            draft={newKeyPolicy}
            onChange={setNewKeyPolicy}
            catalog={policyCatalog}
            loading={policyCatalogLoading}
          />
          {keyStatus ? <StatusAlert status={keyStatus} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleCreateKey} disabled={!newKeyName.trim()} className="flex-1">
              Create
            </Button>
            <Button variant="ghost" onClick={resetAddModal} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        open={!!createdKey}
        title="API Key Created"
        size="md"
        onClose={() => { setCreatedKey(null); setCreatedKeyExpiresAt(null); }}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-dd-lg border border-dd-warning bg-dd-warning/10 p-4 text-dd-warning">
            <p className="mb-2 text-[13px] font-semibold">Save this key now!</p>
            <p className="text-[13px]">This is the only time you will see this key. Store it securely.</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              aria-label="Newly created API key"
              className="flex-1 font-mono text-[13px]"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-dd-muted">
            Expiry: {createdKeyExpiresAt ? new Date(createdKeyExpiresAt).toLocaleString() : "Never expires"}
          </p>
          <Button
            variant="primary"
            onClick={() => { setCreatedKey(null); setCreatedKeyExpiresAt(null); }}
          >
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        open={showEnableTunnelModal}
        title="Enable Tunnel"
        size="md"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">cloud_upload</span>
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-[13px] font-semibold text-dd-text">Cloudflare Tunnel</p>
                <p className="text-[13px] text-dd-muted">
                  Expose your local DurinDoor to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div
                key={benefit.title}
                className="flex flex-col items-center gap-1 rounded-dd-lg bg-dd-surface-2 p-3 text-center"
              >
                <span className="flex size-8 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{benefit.icon}</span>
                </span>
                <p className="text-xs font-semibold text-dd-text">{benefit.title}</p>
                <p className="text-xs text-dd-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-dd-muted">Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleEnableTunnel} className="flex-1">Start Tunnel</Button>
            <Button variant="ghost" onClick={() => setShowEnableTunnelModal(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        open={showDisableTunnelModal}
        title="Disable Tunnel"
        size="sm"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-dd-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              onClick={handleDisableTunnel}
              loading={tunnelLoading}
              disabled={tunnelLoading}
              className="flex-1"
            >
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowDisableTunnelModal(false)}
              disabled={tunnelLoading}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        open={showTsModal}
        title="Tailscale Funnel"
        size="md"
        onClose={() => {
          if (!tsInstalling) {
            setShowTsModal(false);
            setTsSudoPassword("");
            setTsStatus(null);
          }
        }}
      >
        <div className="flex flex-col gap-4">
          {tsInstalled === null ? (
            <p className="flex items-center gap-2 text-[13px] text-dd-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[16px] leading-none">progress_activity</span>
              Checking...
            </p>
          ) : null}

          {tsInstalled === false && !tsInstalling ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-dd-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={handleInstallTailscale} className="flex-1">Install Tailscale</Button>
                <Button variant="ghost" onClick={() => setShowTsModal(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          ) : null}

          {tsInstalling ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-[13px] text-dd-muted">
                <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[16px] leading-none">progress_activity</span>
                Installing Tailscale...
              </p>
              {tsInstallLog.length > 0 ? (
                <div
                  ref={tsLogRef}
                  tabIndex={0}
                  aria-label="Tailscale install log"
                  className="max-h-40 overflow-y-auto rounded-dd bg-dd-surface-2 p-2 font-mono text-xs text-dd-muted"
                 role="region">
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {tsInstalled === true && !tsInstalling ? (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-[13px] text-dd-success">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">check_circle</span>
                Tailscale installed
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => handleConnectTailscale()} className="flex-1">
                  Connect
                </Button>
                <Button variant="ghost" onClick={() => setShowTsModal(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          ) : null}

          {tsStatus ? <StatusAlert status={tsStatus} /> : null}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        open={showDisableTsModal}
        title="Disable Tailscale"
        size="sm"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-dd-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              onClick={handleDisableTailscale}
              loading={tsLoading}
              disabled={tsLoading}
              className="flex-1"
            >
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowDisableTsModal(false)}
              disabled={tsLoading}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit key access and expiry */}
      <Modal
        open={!!editKey}
        title={`Edit API Key — ${editKey?.name || ""}`}
        size="lg"
        onClose={resetEditModal}
      >
        <div className="flex flex-col gap-4">
          <Field label="Expiry">
            <Select
              value={editKeyExpiryPreset}
              onChange={(value) => { setEditKeyExpiryPreset(value); setEditKeyStatus(null); }}
              options={expiryOptions}
              aria-label="Expiry preset"
            />
          </Field>
          {editKeyExpiryPreset === "custom" ? (
            <Input
              label="Custom expiry (local time)"
              type="datetime-local"
              value={editKeyCustomExpiresAt}
              onChange={(event) => { setEditKeyCustomExpiresAt(event.target.value); setEditKeyStatus(null); }}
            />
          ) : null}
          <Input
            label="Daily token limit"
            type="number"
            min="0"
            step="1"
            value={editKeyDailyLimitTokens}
            onChange={(event) => { setEditKeyDailyLimitTokens(event.target.value); setEditKeyStatus(null); }}
            placeholder="Unlimited (leave empty to clear)"
          />
          {combos.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-dd-muted">Select which combos this key can access. Leave empty to allow all.</p>
              <div tabIndex={0} aria-label="Allowed combos for key" className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-dd-lg border border-dd-border p-2" role="region">
                {combos.map((combo) => (
                  <Checkbox
                    key={combo.id || combo.name}
                    checked={editKeyAllowedCombos.includes(combo.name)}
                    onChange={() => {
                      setEditKeyAllowedCombos((prev) =>
                        prev.includes(combo.name)
                          ? prev.filter((c) => c !== combo.name)
                          : [...prev, combo.name]
                      );
                    }}
                    label={combo.name}
                    hint={combo.kind}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-dd-muted">No combos available.</p>
          )}
          <div className="flex flex-col gap-2">
            <Field
              label="Provider accounts"
              hint="Restrict this key to a subset of provider accounts. Leave empty for unrestricted access. The zero-relation rule (no rows = unrestricted) is preserved."
            >
              <Select
                value=""
                placeholder="Add provider account"
                options={editKeyProviderOptions}
                onChange={(value) =>
                  value
                    ? setEditKeyProviderConnectionIds((prev) => (prev.includes(value) ? prev : [...prev, value]))
                    : undefined
                }
              />
            </Field>
            <DataTable
              ariaLabel="Scoped provider accounts for this key"
              columns={[
                { key: "name", label: "Name" },
                { key: "provider", label: "Provider" },
                { key: "id", label: "ID", mono: true },
                {
                  key: "remove",
                  label: "Actions",
                  align: "right",
                  render: (row) => (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setEditKeyProviderConnectionIds((prev) => prev.filter((value) => value !== row.id))
                      }
                    >
                      Remove
                    </Button>
                  ),
                },
              ]}
              rows={editKeyProviderConnectionIds.map((id) => {
                const connection = providerConnections.find((item) => item.id === id) || { id, name: id, provider: "unknown" };
                return { id, name: connection.name || id, provider: connection.provider };
              })}
              keyFn={(row) => row.id}
              density="compact"
              emptyState={{ title: "No scoped accounts", message: "This key can route through every provider account." }}
            />
          </div>
          {isEditableApiKeyPolicy(editKey?.policy) ? (
            <ApiKeyPolicyFields
              draft={editKeyPolicy}
              onChange={(next) => { setEditKeyPolicy(next); setEditKeyPolicyDirty(true); }}
              catalog={policyCatalog}
              loading={policyCatalogLoading}
              usage={editKey?.usage}
            />
          ) : (
            <StatusAlert
              status={{
                type: "error",
                message: "This key has malformed stored policy data. Other key details can be saved safely, but repair or clear the policy through the management API before editing it here.",
              }}
            />
          )}
          {editKeyStatus ? <StatusAlert status={editKeyStatus} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              className="flex-1"
              onClick={async () => {
                if (!editKey) return;
                let expiresAt;
                let policy;
                try {
                  expiresAt = expiryFromSelection(editKeyExpiryPreset, editKeyCustomExpiresAt);
                  policy = apiKeyPolicyPatchFromDraft(editKeyPolicy, editKeyPolicyDirty);
                } catch (error) {
                  setEditKeyStatus({ type: "error", message: error.message });
                  return;
                }
                const parsedLimit = editKeyDailyLimitTokens.trim() === "" ? null : Number(editKeyDailyLimitTokens);
                if (parsedLimit !== null && (!Number.isSafeInteger(parsedLimit) || parsedLimit < 0)) {
                  setEditKeyStatus({ type: "error", message: "Daily limit must be a non-negative whole number" });
                  return;
                }
                const updated = await handleUpdateKeyDetails(editKey.id, editKeyAllowedCombos, expiresAt, policy, parsedLimit, editKeyProviderConnectionIds);
                if (!updated) return;
                resetEditModal();
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={resetEditModal} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal (pause / delete) */}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        confirmLabel="Confirm"
        tone="danger"
        onConfirm={confirmState?.onConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
  localPort: PropTypes.number,
};
