"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
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
import Tooltip from "./components/Tooltip";
import SecurityWarning from "./components/SecurityWarning";
import StatusAlert from "./components/StatusAlert";
import MonitoringStrip from "./components/MonitoringStrip";
import DocsLink from "@/shared/components/DocsLink";
import { isBrowser } from "@/shared/utils/typeChecks.js";

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


export default function EndpointPageClient({ localPort = 20128 }) {
  const [loading, setLoading] = useState(true);
  const [tunnelExternal, setTunnelExternal] = useState(null);
  const [tsExternal, setTsExternal] = useState(null);
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
  const { copied, copy } = useCopyToClipboard();

  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  useEffect(() => {
    loadSettings().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isBrowser()) setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
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


  const currentEndpoint = getLocalEndpointUrl(localPort);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        icon="key"
        title="Endpoint"
        subtitle="API endpoint and remote access configuration"
      />
      {/* Endpoint Card */}
      <Card id="require-api-key" padding={false}>
        <CardHeader icon="api" title="API Endpoint" />
        <CardContent>
          <div className="mb-4 flex items-center justify-between border-b border-dd-border-subtle pb-4">
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
                <div className="flex min-w-0 flex-1 items-center gap-2 bg-dd-accent-soft px-3 py-1.5 text-[13px] text-dd-accent">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">cloud_done</span>
                  <span className="font-medium">External</span>
                  <span
                    className="min-w-0 flex-1 select-all break-all font-mono text-xs"
                    aria-label="External tunnel URL"
                  >
                    {`${tunnelExternal.tunnelUrl}/v1`}
                  </span>
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
                  <span
                    className="min-w-0 flex-1 select-all break-all rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2 py-1.5 font-mono text-xs text-dd-text"
                    aria-label="Cloudflare tunnel URL"
                  >
                    {`${tunnelUrl}/v1`}
                  </span>
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
                <div className="flex min-w-0 flex-1 items-center gap-2 bg-dd-accent-soft px-3 py-1.5 text-[13px] text-dd-accent">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">vpn_lock</span>
                  <span className="font-medium">External</span>
                  <span
                    className="min-w-0 flex-1 select-all break-all font-mono text-xs"
                    aria-label="External Tailscale URL"
                  >
                    {`${tsExternal.tunnelUrl}/v1`}
                  </span>
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
                  <span
                    className="min-w-0 flex-1 select-all break-all rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2 py-1.5 font-mono text-xs text-dd-text"
                    aria-label="Tailscale URL"
                  >
                    {`${tsUrl}/v1`}
                  </span>
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
              <div className="mt-4 flex flex-col gap-1.5 border-t border-dd-border-subtle pt-3">
                <p className="px-1 text-xs font-medium text-dd-muted">All Cloudflare endpoints</p>
                {tunnelAllUrls.map((u) => (
                  <div key={u} className="flex items-center gap-2 px-2 py-1 text-[13px]">
                    <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[16px] leading-none text-dd-muted">link</span>
                    <span
                      className="min-w-0 flex-1 select-all break-all font-mono text-xs text-dd-text"
                      aria-label={`Cloudflare endpoint ${u}`}
                    >
                      {`${u}/v1`}
                    </span>
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

      {/* Activity: in-flight requests, provider health, recent requests */}
      <MonitoringStrip />

      {/* Enable Tunnel Modal */}
      <Modal
        open={showEnableTunnelModal}
        title="Enable Tunnel"
        size="md"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-dd-muted">Cloudflare Tunnel gives this DurinDoor a public HTTPS URL. Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.</p>
          {!requireApiKey ? <p className="text-xs text-dd-warning">Turn on Require API Key before you share the tunnel URL.</p> : null}
          <DocsLink path="deployment/localhost#cloudflare-tunnel" />
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
    </div>
  );
}

EndpointPageClient.propTypes = {
  localPort: PropTypes.number,
};
