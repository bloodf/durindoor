"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton, Toggle, ConfirmModal } from "@/shared/components";
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

export default function APIPageClient({ machineId, localPort = 20128 }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [newKeyPolicy, setNewKeyPolicy] = useState(emptyApiKeyPolicyDraft);
  const [editKey, setEditKey] = useState(null);
  const [editKeyAllowedCombos, setEditKeyAllowedCombos] = useState([]);
  const [editKeyExpiryPreset, setEditKeyExpiryPreset] = useState("never");
  const [editKeyDailyLimitTokens, setEditKeyDailyLimitTokens] = useState("");
  const [editKeyCustomExpiresAt, setEditKeyCustomExpiresAt] = useState("");
  const [editKeyStatus, setEditKeyStatus] = useState(null);
  const [editKeyPolicy, setEditKeyPolicy] = useState(emptyApiKeyPolicyDraft);
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
  const [tsInstalled, setTsInstalled] = useState(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const tsLogRef = useRef(null);

  // Debounce reachable=false: server may briefly return false during background refresh.
  // Only flip UI to "reconnecting" after N consecutive misses to avoid spinner flicker.
  const tunnelMissRef = useRef(0);
  const tsMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  const tsClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  // Distinguishes "Checking..." (initial cold cache) from "Reconnecting..." (lost connection).
  const tunnelEverReachableRef = useRef(false);
  const tsEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);

  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined")
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  const { copied, copy } = useCopyToClipboard();

  // Security gate: block remote exposure while dashboard uses default password or login is off.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    fetchData();
    fetchPolicyCatalog();
    loadSettings();
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
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

  // Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI stays
  // "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or *.trycloudflare.com.
  // Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) { tunnelMissRef.current = 0; setTunnelReachable(true); if (!tunnelEverReachableRef.current) { tunnelEverReachableRef.current = true; setTunnelEverReachable(true); } }
        else { tunnelMissRef.current += 1; if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false); }
      } else {
        tunnelClientReachableRef.current = false;
      }
      if (tsEnabled && tsUrl) {
        const ok = await clientPingUrl(tsUrl);
        tsClientReachableRef.current = ok;
        if (ok) { tsMissRef.current = 0; setTsReachable(true); if (!tsEverReachableRef.current) { tsEverReachableRef.current = true; setTsEverReachable(true); } }
        else { tsMissRef.current += 1; if (tsMissRef.current >= REACHABLE_MISS_THRESHOLD) setTsReachable(false); }
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

  // Client-side reachable only (server no longer probes; watchdog handles backend health).
  // Miss-debounce: only flip to false after N consecutive misses.
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

  // Render actual composite state; settingsEnabled remains server-side restart intent.
  const syncTunnelStatus = async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return;
      const data = await statusRes.json();
      const tEnabled = getCompositeEndpointEnabled(data.tunnel);
      const tUrl = data.tunnel?.tunnelUrl || "";
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || "");
      setTunnelAllUrls(Array.isArray(data.tunnel?.allUrls) ? data.tunnel.allUrls : []);
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
        fetch("/api/tunnel/status", { cache: "no-store" })
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
        setTunnelAllUrls(Array.isArray(data.tunnel?.allUrls) ? data.tunnel.allUrls : []);
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
    try {
      const [keysRes, combosRes] = await Promise.all([
        fetch("/api/keys"),
        fetch("/api/combos"),
      ]);
      const keysData = await keysRes.json();
      if (keysRes.ok) {
        setKeys(keysData.keys || []);
      }
      if (combosRes.ok) {
        const combosData = await combosRes.json();
        setCombos(combosData.combos || combosData || []);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
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

  // u2500u2500u2500 Cloudflare Tunnel handlers
  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
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
      // Every 5 pings (~10s), check if backend process still alive
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

    // Poll download progress while enable request is pending
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

  // u2500u2500u2500 Tailscale handlers
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

  // Ping Tailscale health until reachable
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

  // Show inline login button instead of auto-opening popup (browsers block popups
  // opened after async work because the user gesture is lost).
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
        body: JSON.stringify({ name: newKeyName, allowedCombos: newKeyAllowedCombos, dailyLimitTokens, expiresAt, policy }),
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

  // Reveal the stored secret for an existing key (masked in the list) and copy
  // it. The raw key never rides in the list response; it is fetched on demand.
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

  const handleDeleteKey = async (id) => {
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
      }
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
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const handleUpdateKeyDetails = async (id, allowedCombos, expiresAt, policyPatch, dailyLimitTokens = null) => {
    try {
      const payload = { allowedCombos, expiresAt, dailyLimitTokens };
      // Edit sends field patches, not a replacement policy envelope. This
      // preserves forward-compatible fields that this UI does not understand.
      if (policyPatch) Object.assign(payload, policyPatch);
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? data.key : k));
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
        setKeys(prev => prev.map(k => k.id === id ? { ...k, dailyLimitTokens } : k));
      }
    } catch (error) {
      console.log("Error updating key limit:", error);
    }
  };

  const beginEditKey = (key) => {
    const expiry = expirySelectionFromValue(key.expiresAt);
    setEditKey(key);
    setEditKeyAllowedCombos(Array.isArray(key.allowedCombos) ? [...key.allowedCombos] : []);
    setEditKeyExpiryPreset(expiry.selection);
    setEditKeyCustomExpiresAt(expiry.customLocalValue);
    setEditKeyDailyLimitTokens(key.dailyLimitTokens == null ? "" : String(key.dailyLimitTokens));
    setEditKeyPolicy(apiKeyPolicyToDraft(key.policy));
    setEditKeyPolicyDirty(false);
    setEditKeyStatus(null);
  };

  const currentEndpoint = getLocalEndpointUrl(localPort);

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
      {/* Endpoint Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">api</span>
          API Endpoint
        </h2>

        {/* Endpoint rows */}
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
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${

              tunnelEnabled || tunnelExternal ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tunnel</span>
            {tunnelExternal && !tunnelEnabled ? (
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-primary/30 bg-primary/5 text-sm text-primary">
                <span className="material-symbols-outlined text-sm">cloud_done</span>
                <span className="font-medium">External</span>
                <Input value={`${tunnelExternal.tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm bg-transparent border-0" />
                <button
                  onClick={() => copy(`${tunnelExternal.tunnelUrl}/v1`, "tunnel_url")}
                  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                  title="Copy URL"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "tunnel_url" ? "check" : "content_copy"}</span>
                </button>
              </div>
            ) : tunnelEnabled && !tunnelLoading && tunnelReachable ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tunnelEverReachable ? "Tunnel reconnecting..." : "Tunnel checking..."}
                </div>
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tunnel"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelLoading ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tunnelProgress || "Creating tunnel..."}
                </div>
                <button
                  onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tunnelStatus?.type === "error" ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {tunnelStatus.message}
                </div>
                <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
              </>
            ) : tunnelChecking ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  Checking...
                </div>
                <button
                  onClick={() => setTunnelChecking(false)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
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
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${

              tsEnabled || tsExternal ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tailscale</span>
            {tsExternal?.tunnelUrl && !tsEnabled ? (
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-primary/30 bg-primary/5 text-sm text-primary">
                <span className="material-symbols-outlined text-sm">vpn_lock</span>
                <span className="font-medium">External</span>
                <Input value={`${tsExternal.tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm bg-transparent border-0" />
                <button
                  onClick={() => copy(`${tsExternal.tunnelUrl}/v1`, "ts_url")}
                  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                  title="Copy URL"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "ts_url" ? "check" : "content_copy"}</span>
                </button>
              </div>
            ) : tsEnabled && !tsLoading && tsReachable ? (
              <>
                <Input value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
                <button
                  onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
                  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "ts_url" ? "check" : "content_copy"}</span>
                </button>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tailscale"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tsEnabled && !tsLoading && !tsReachable ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tsEverReachable ? "Tailscale reconnecting..." : "Tailscale checking..."}
                </div>
                <button
                  onClick={() => setShowDisableTsModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Disable Tailscale"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : (tsLoading || tsConnecting) ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                  {tsProgress || "Connecting..."}
                </div>
                {tsAuthUrl && (
                  <Button
                    size="sm"
                    icon="open_in_new"
                    onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
                  >
                    {tsAuthLabel || "Open"}
                  </Button>
                )}
                <button
                  onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(""); clearUserAuth(); }}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
                  title="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              </>
            ) : tsStatus?.type === "error" ? (
              <>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {tsStatus.message}
                </div>
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
                className="bg-linear-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white!"
              >
                Enable
              </Button>
            )}
          </div>
          {tunnelAllUrls.length > 1 && (
            <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/50 p-2">
              <p className="text-xs font-medium text-text-muted px-1">All Cloudflare endpoints</p>
              {tunnelAllUrls.map((u) => (
                <div key={u} className="flex items-center gap-2 px-2 py-1 rounded bg-surface text-sm">
                  <span className="material-symbols-outlined text-[16px] text-text-muted shrink-0">link</span>
                  <Input value={`${u}/v1`} readOnly className="flex-1 font-mono text-xs bg-transparent border-0" />
                  <button
                    onClick={() => copy(`${u}/v1`, `all_${u}`)}
                    className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
                    title="Copy URL"
                  >
                    <span className="material-symbols-outlined text-[16px]">{copied === `all_${u}` ? "check" : "content_copy"}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pre-enable security gate banner */}
        {isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
          <div className="mt-4">
            <SecurityWarning
              message={unsafeReason}
              action={{ label: "Open settings", href: "/dashboard/profile" }}
            />
          </div>
        )}

        {/* Security warnings when tunnel or tailscale is active */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 flex flex-col gap-2">
            {!requireApiKey && (
              <SecurityWarning
                message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                action={{ label: "Enable", href: "#require-api-key" }}
              />
            )}
            {(!requireLogin || !hasPassword) && (
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
            )}
          </div>
        )}

        {/* Tunnel dashboard access option */}
        {(tunnelEnabled || tsEnabled) && (
          <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
            <Toggle
              checked={tunnelDashboardAccess}
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
              <Tooltip text="When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked." />
            </div>
          </div>
        )}
      </Card>

      {/* API Keys */}
      <Card id="require-api-key">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">vpn_key</span>
            API Keys
            {keys.length > 0 && (
              <span className="rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                {keys.length}
              </span>
            )}
          </h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
          <div>
            <p className="font-medium">Require API key</p>
            <p className="text-sm text-text-muted">
              Requests without a valid key will be rejected
            </p>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => handleRequireApiKey(!requireApiKey)}
          />
        </div>

        {isRemoteHost && !requireApiKey && (
          <div className="mb-4 -mt-2">
            <SecurityWarning message="Endpoint is exposed without an API key." />
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-text-main font-medium mb-1">No API keys yet</p>
            <p className="text-sm text-text-muted mb-4">Create your first API key to get started</p>
            <Button icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((key) => {
              const policyUsage = formatPolicyUsage(key.usage, key.policy);
              const policyInvalid = !isEditableApiKeyPolicy(key.policy);
              return (
              <div
                key={key.id}
                className={`group flex items-start justify-between gap-3 rounded-lg px-3 py-3 -mx-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${key.isActive === false ? "opacity-60" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  {/* Name + status */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate">{key.name}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        key.isActive === false
                          ? "bg-orange-500/10 text-orange-500"
                          : "bg-green-500/10 text-green-600 dark:text-green-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${key.isActive === false ? "bg-orange-500" : "bg-green-500"}`} />
                      {key.isActive === false ? "Paused" : "Active"}
                    </span>
                  </div>
                  {/* Masked key */}
                  <code className="mt-1 block text-xs text-text-muted font-mono">
                    {key.maskedKey || "***"}
                  </code>
                  {/* Metadata chips */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded bg-black/[0.04] dark:bg-white/[0.04] px-1.5 py-0.5 text-text-muted">
                      <span className="material-symbols-outlined text-[13px]">schedule</span>
                      Created {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${formatKeyExpiry(key.expiresAt).danger ? "bg-red-500/10 text-red-500" : "bg-black/[0.04] dark:bg-white/[0.04] text-text-muted"}`}>
                      <span className="material-symbols-outlined text-[13px]">event</span>
                      {formatKeyExpiry(key.expiresAt).text}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${policyInvalid || policyUsage.tokensExceeded || policyUsage.costExceeded ? "bg-red-500/10 text-red-500" : "bg-black/[0.04] dark:bg-white/[0.04] text-text-muted"}`}>
                      <span className="material-symbols-outlined text-[13px]">tune</span>
                      {policyInvalid ? "Invalid policy" : `Models: ${key.policy?.allowedModels?.length ? key.policy.allowedModels.length : "All"}`}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-black/[0.04] dark:bg-white/[0.04] px-1.5 py-0.5 text-text-muted">
                      <span className="material-symbols-outlined text-[13px]">data_usage</span>
                      {policyUsage.tokens} tok · {policyUsage.cost}
                      {(policyUsage.tokensExceeded || policyUsage.costExceeded) && " · limit reached"}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-black/[0.04] dark:bg-white/[0.04] px-1.5 py-0.5 text-text-muted">
                      <span className="material-symbols-outlined text-[13px]">speed</span>
                      {key.dailyLimitTokens == null ? "No daily limit" : `${key.dailyLimitTokens.toLocaleString()}/day`}
                    </span>
                  </div>
                  {/* Combos */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-text-muted">Combos:</span>
                    {Array.isArray(key.allowedCombos) && key.allowedCombos.length > 0 ? (
                      key.allowedCombos.map((c) => (
                        <span key={c} className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{c}</span>
                      ))
                    ) : (
                      <span className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">All</span>
                    )}
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Toggle
                    size="sm"
                    checked={key.isActive ?? true}
                    onChange={(checked) => {
                      if (key.isActive && !checked) {
                        setConfirmState({
                          title: "Pause API Key",
                          message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
                          onConfirm: async () => {
                            setConfirmState(null);
                            handleToggleKey(key.id, checked);
                          }
                        });
                      } else {
                        handleToggleKey(key.id, checked);
                      }
                    }}
                    title={key.isActive ? "Pause key" : "Resume key"}
                  />
                  <button
                    onClick={() => revealAndCopyKey(key.id)}
                    className={`p-2 rounded transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${copied === `reveal_${key.id}` ? "text-green-600 dark:text-green-400" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
                    title="Reveal and copy the full key"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {copied === `reveal_${key.id}` ? "check" : "content_copy"}
                    </span>
                  </button>
                  <button
                    onClick={() => beginEditKey(key)}
                    className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                    title="Edit key access and expiry"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </button>
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                    title="Delete key"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
          setNewKeyDailyLimitTokens("");
          setNewKeyExpiryPreset("never");
          setNewKeyCustomExpiresAt("");
          setNewKeyPolicy(emptyApiKeyPolicyDraft());
          setKeyStatus(null);
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
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
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Expiry
            <select
              value={newKeyExpiryPreset}
              onChange={(event) => { setNewKeyExpiryPreset(event.target.value); setKeyStatus(null); }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {API_KEY_EXPIRY_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </label>
          {newKeyExpiryPreset === "custom" && (
            <Input
              label="Custom expiry (local time)"
              type="datetime-local"
              value={newKeyCustomExpiresAt}
              onChange={(event) => { setNewKeyCustomExpiresAt(event.target.value); setKeyStatus(null); }}
            />
          )}
          {combos.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Allowed Combos</p>
              <p className="text-xs text-text-muted mb-2">Choose &quot;All combos&quot; for unrestricted access, or select specific combos to restrict this key.</p>
              <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={newKeyAllowedCombos.length === 0}
                    onChange={() => setNewKeyAllowedCombos([])}
                    className="rounded border-border"
                  />
                  <span>All combos</span>
                </label>
                {combos.map((combo) => (
                  <label key={combo.id || combo.name} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={newKeyAllowedCombos.includes(combo.name)}
                      onChange={() => {
                        setNewKeyAllowedCombos(prev =>
                          prev.includes(combo.name)
                            ? prev.filter(c => c !== combo.name)
                            : [...prev, combo.name]
                        );
                      }}
                      className="rounded border-border"
                    />
                    <span>{combo.name}</span>
                    {combo.kind && <span className="text-xs text-text-muted">({combo.kind})</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          <ApiKeyPolicyFields
            draft={newKeyPolicy}
            onChange={setNewKeyPolicy}
            catalog={policyCatalog}
            loading={policyCatalogLoading}
          />
          {keyStatus && <StatusAlert status={keyStatus} />}
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
                setNewKeyDailyLimitTokens("");
                setNewKeyExpiryPreset("never");
                setNewKeyCustomExpiresAt("");
                setNewKeyAllowedCombos([]);
                setNewKeyPolicy(emptyApiKeyPolicyDraft());
                setKeyStatus(null);
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => { setCreatedKey(null); setCreatedKeyExpiresAt(null); }}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <p className="text-sm text-text-muted">
            Expiry: {createdKeyExpiresAt ? new Date(createdKeyExpiresAt).toLocaleString() : "Never expires"}
          </p>
          <Button onClick={() => { setCreatedKey(null); setCreatedKeyExpiresAt(null); }} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary">cloud_upload</span>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local DurinDoor to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <span className="material-symbols-outlined text-xl text-primary mb-1">{benefit.icon}</span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); setTsStatus(null); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
              Checking...
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">Tailscale is not installed. Install it to enable Funnel.</p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
                  Install Tailscale
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                Installing Tailscale...
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted">
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Tailscale installed
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleConnectTailscale()}
                  fullWidth
                >
                  Connect
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        isOpen={showDisableTsModal}
        title="Disable Tailscale"
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Edit key access and expiry */}
      <Modal
        isOpen={!!editKey}
        title={`Edit API Key — ${editKey?.name || ""}`}
        onClose={() => { setEditKey(null); setEditKeyAllowedCombos([]); setEditKeyPolicy(emptyApiKeyPolicyDraft()); setEditKeyPolicyDirty(false); setEditKeyStatus(null); }}
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Expiry
            <select
              value={editKeyExpiryPreset}
              onChange={(event) => { setEditKeyExpiryPreset(event.target.value); setEditKeyStatus(null); }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {API_KEY_EXPIRY_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </label>
          {editKeyExpiryPreset === "custom" && (
            <Input
              label="Custom expiry (local time)"
              type="datetime-local"
              value={editKeyCustomExpiresAt}
              onChange={(event) => { setEditKeyCustomExpiresAt(event.target.value); setEditKeyStatus(null); }}
            />
          )}
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
            <div>
              <p className="text-sm text-text-muted mb-2">Select which combos this key can access. Leave empty to allow all.</p>
              <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                {combos.map((combo) => (
                  <label key={combo.id || combo.name} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={editKeyAllowedCombos.includes(combo.name)}
                      onChange={() => {
                        setEditKeyAllowedCombos(prev =>
                          prev.includes(combo.name)
                            ? prev.filter(c => c !== combo.name)
                            : [...prev, combo.name]
                        );
                      }}
                      className="rounded border-border"
                    />
                    <span>{combo.name}</span>
                    {combo.kind && <span className="text-xs text-text-muted">({combo.kind})</span>}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No combos available.</p>
          )}
          {isEditableApiKeyPolicy(editKey?.policy) ? (
            <ApiKeyPolicyFields
              draft={editKeyPolicy}
              onChange={(next) => { setEditKeyPolicy(next); setEditKeyPolicyDirty(true); }}
              catalog={policyCatalog}
              loading={policyCatalogLoading}
              usage={editKey?.usage}
            />
          ) : (
            <StatusAlert status={{ type: "error", message: "This key has malformed stored policy data. Other key details can be saved safely, but repair or clear the policy through the management API before editing it here." }} />
          )}
          {editKeyStatus && <StatusAlert status={editKeyStatus} />}
          <div className="flex gap-2">
            <Button
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
                const updated = await handleUpdateKeyDetails(editKey.id, editKeyAllowedCombos, expiresAt, policy, parsedLimit);
                if (!updated) return;
                setEditKey(null);
                setEditKeyAllowedCombos([]);
                setEditKeyPolicy(emptyApiKeyPolicyDraft());
                setEditKeyPolicyDirty(false);
                setEditKeyStatus(null);
              }}
              fullWidth
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setEditKey(null);
                setEditKeyAllowedCombos([]);
                setEditKeyPolicy(emptyApiKeyPolicyDraft());
                setEditKeyPolicyDirty(false);
                setEditKeyStatus(null);
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}


APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
  localPort: PropTypes.number,
};
