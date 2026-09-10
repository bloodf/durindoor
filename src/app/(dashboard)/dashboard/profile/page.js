"use client";

import { useState, useEffect, useRef } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardFooter, CardHeader } from "@/shared/ui/components/Card.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import { useTheme } from "@/shared/hooks/useTheme";
import { APP_CONFIG } from "@/shared/constants/config";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
import { isBrowser, isUndefined } from "../../../../shared/utils/typeChecks.js";
import SelectiveTransferPanel from "./SelectiveTransferPanel";

const DATA_RETENTION_PRESETS = [7, 15, 30, 60, 90];

function describeRetentionRun(run) {
  if (!run?.ranAt) return "";
  const deleted = run.deleted || {};
  const total = Object.values(deleted).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const when = new Date(run.ranAt).toLocaleString();
  const detail = Object.entries(deleted).map(([store, count]) => `${store} ${count}`).join(", ");
  const failed = run.errors ? ` Some stores failed: ${Object.keys(run.errors).join(", ")}.` : "";
  return `Last cleanup ${when}: removed ${total} records older than ${run.days} days${detail ? ` (${detail})` : ""}.${failed}`;
}

function getLocaleFromCookie() {
  if (isUndefined(globalThis.document)) return "en";
  const cookie = document.cookie.
  split(";").
  find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function ProfilePage() {
  const { theme, setTheme } = useTheme();
  const [locale, setLocale] = useState("en");
  const [langOpen, setLangOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState({ type: "", message: "" });
  const [dbAuth, setDbAuth] = useState({ open: false, mode: "", password: "" });
  const pendingImportRef = useRef(null);
  const [oidcForm, setOidcForm] = useState({
    authMode: "password",
    oidcIssuerUrl: "",
    oidcClientId: "",
    oidcScopes: "openid profile email",
    oidcLoginLabel: "Sign in with OIDC"
  });
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcStatus, setOidcStatus] = useState({ type: "", message: "" });
  const [oidcLoading, setOidcLoading] = useState(false);
  const [oidcTestLoading, setOidcTestLoading] = useState(false);
  const [oidcTestStatus, setOidcTestStatus] = useState({ type: "", message: "" });
  const [oidcRedirectUri, setOidcRedirectUri] = useState("/api/auth/oidc/callback");
  const [oidcExpanded, setOidcExpanded] = useState(false);
  const importFileRef = useRef(null);
  const [proxyForm, setProxyForm] = useState({
    outboundProxyEnabled: false,
    outboundProxyUrl: "",
    outboundNoProxy: ""
  });
  const [firecrawlUrl, setFirecrawlUrl] = useState("");
  const [firecrawlUrlStatus, setFirecrawlUrlStatus] = useState({ type: "", message: "" });
  const [firecrawlUrlLoading, setFirecrawlUrlLoading] = useState(false);
  const [proxyStatus, setProxyStatus] = useState({ type: "", message: "" });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  // Port of decolua/9router#3801: footer mode label is derived from the page
  // hostname so remote deployments stop claiming "Local Mode".
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (isBrowser()) {
      // location.hostname keeps the brackets on IPv6 literals ("[::1]").
      const host = window.location.hostname.replace(/^\[|\]$/g, "");
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(host));
    }
  }, []);

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, [langOpen]);

  useEffect(() => {
    fetch("/api/settings").
    then((res) => res.json()).
    then((data) => {
      setSettings(data);
      setOidcForm({
        authMode: data?.authMode || "password",
        oidcIssuerUrl: data?.oidcIssuerUrl || "",
        oidcClientId: data?.oidcClientId || "",
        oidcScopes: data?.oidcScopes || "openid profile email",
        oidcLoginLabel: data?.oidcLoginLabel || "Sign in with OIDC"
      });
      setOidcClientSecret("");
      if (data?.authMode === "oidc" || data?.authMode === "both") setOidcExpanded(true);
      setProxyForm({
        outboundProxyEnabled: data?.outboundProxyEnabled === true,
        outboundProxyUrl: data?.outboundProxyUrl || "",
        outboundNoProxy: data?.outboundNoProxy || ""
      });
      setFirecrawlUrl(data?.firecrawlBaseUrl || "");
      setLoading(false);
    }).
    catch((err) => {
      console.error("Failed to fetch settings:", err);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (isBrowser()) {
      setOidcRedirectUri(`${window.location.origin}/api/auth/oidc/callback`);
    }
  }, []);

  const updateFirecrawlUrl = async (e) => {
    e.preventDefault();
    const value = firecrawlUrl.trim();
    if (value) {
      try {
        new URL(value);
      } catch {
        setFirecrawlUrlStatus({ type: "error", message: "Invalid URL" });
        return;
      }
    }
    setFirecrawlUrlLoading(true);
    setFirecrawlUrlStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firecrawlBaseUrl: value || "" })
      });
      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, firecrawlBaseUrl: data?.firecrawlBaseUrl || "" }));
        setFirecrawlUrl(data?.firecrawlBaseUrl || "");
        setFirecrawlUrlStatus({ type: "success", message: "Firecrawl URL saved" });
      } else {
        setFirecrawlUrlStatus({ type: "error", message: data.error || "Failed to save Firecrawl URL" });
      }
    } catch (err) {
      setFirecrawlUrlStatus({ type: "error", message: "An error occurred" });
    } finally {
      setFirecrawlUrlLoading(false);
    }
  };

  const updateOutboundProxy = async (e) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProxyUrl: proxyForm.outboundProxyUrl,
          outboundNoProxy: proxyForm.outboundNoProxy
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyStatus({ type: "success", message: "Proxy settings applied" });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;

    const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
    if (!proxyUrl) {
      setProxyStatus({ type: "error", message: "Please enter a Proxy URL to test" });
      return;
    }

    setProxyTestLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings/proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl })
      });

      const data = await res.json();
      if (res.ok && data?.ok) {
        setProxyStatus({
          type: "success",
          message: `Proxy test OK (${data.status}) in ${data.elapsedMs}ms`
        });
      } else {
        setProxyStatus({
          type: "error",
          message: data?.error || "Proxy test failed"
        });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled) => {
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundProxyEnabled })
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyForm((prev) => ({ ...prev, outboundProxyEnabled: data?.outboundProxyEnabled === true }));
        setProxyStatus({
          type: "success",
          message: outboundProxyEnabled ? "Proxy enabled" : "Proxy disabled"
        });
      } else {
        setProxyStatus({ type: "error", message: data.error || "Failed to update proxy settings" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new
        })
      });

      const data = await res.json();

      if (res.ok && data?.reauthenticate) {
        window.location.assign("/login");
        return;
      }
      if (res.ok) {
        setPassStatus({ type: "success", message: "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({ type: "error", message: data.error || "Failed to update password" });
      }
    } catch (err) {
      setPassStatus({ type: "error", message: "An error occurred" });
    } finally {
      setPassLoading(false);
    }
  };

  const updateFallbackStrategy = async (strategy) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallbackStrategy: strategy })
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update settings:", err);
    }
  };

  const updateComboStrategy = async (strategy) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategy: strategy })
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, comboStrategy: strategy }));
      }
    } catch (err) {
      console.error("Failed to update combo strategy:", err);
    }
  };

  const updateVisionBridge = async (patch) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...patch }));
      }
    } catch (err) {
      console.error("Failed to update Vision Bridge settings:", err);
    }
  };

  const handleVisionBridgeToggle = async () => {
    const enabling = !(settings.visionBridgeEnabled === true);
    const target = (settings.visionBridgeModel || "").trim();
    // Guard against a silent no-op: enabling with an empty target never reroutes
    // (the helper passes through when visionBridgeModel is empty/invalid). Clear
    // any in-flight draft into the committed value first so a typed-but-not-
    // blurred target still enables.
    const input = !isUndefined(globalThis.document) ?
    document.getElementById("vision-bridge-model-input") :
    null;
    const draft = (input?.value || "").trim();
    if (enabling && !target && !draft) return;
    const patch = draft && draft !== target ?
    { visionBridgeModel: draft, visionBridgeEnabled: enabling } :
    { visionBridgeEnabled: enabling };
    await updateVisionBridge(patch);
  };

  const updateStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickyRoundRobinLimit: numLimit })
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Failed to update sticky limit:", err);
    }
  };

  const updateComboStickyLimit = async (limit) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStickyRoundRobinLimit: numLimit })
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, comboStickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Failed to update combo sticky limit:", err);
    }
  };

  const updateHidePaidModels = async (hidePaidModels) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidePaidModels })
      });
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => ({ ...prev, hidePaidModels: data.hidePaidModels === true }));
      }
    } catch (err) {
      console.error("Failed to update hide paid models:", err);
    }
  };

  const updateExposeComboOnly = async (exposeComboOnly) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exposeComboOnly })
      });
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => ({ ...prev, exposeComboOnly: data.exposeComboOnly === true }));
      }
    } catch (err) {
      console.error("Failed to update combo-only model exposure:", err);
    }
  };

  const updateRequireLogin = async (requireLogin) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin })
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Failed to update require login:", err);
    }
  };

  const updateOidcForm = (field, value) => {
    setOidcForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveOidcSettings = async (authMode = oidcForm.authMode || "password") => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const loginLabel = oidcForm.oidcLoginLabel.trim();
    const secret = oidcClientSecret.trim();

    if (authMode !== "password" && (!issuerUrl || !clientId || !secret) && !settings.oidcConfigured) {
      setOidcStatus({ type: "error", message: "Issuer URL, client ID, and client secret are required to enable OIDC." });
      return;
    }

    setOidcLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    try {
      const payload = {
        authMode,
        oidcIssuerUrl: issuerUrl,
        oidcClientId: clientId,
        oidcScopes: scopes || "openid profile email",
        oidcLoginLabel: loginLabel || "Sign in with OIDC"
      };
      if (secret) {
        payload.oidcClientSecret = secret;
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setOidcForm({
          authMode: data?.authMode || authMode,
          oidcIssuerUrl: data?.oidcIssuerUrl || issuerUrl,
          oidcClientId: data?.oidcClientId || clientId,
          oidcScopes: data?.oidcScopes || scopes || "openid profile email",
          oidcLoginLabel: data?.oidcLoginLabel || loginLabel || "Sign in with OIDC"
        });
        setOidcClientSecret("");
        setOidcStatus({
          type: "success",
          message:
          authMode === "oidc" ?
          "OIDC login enabled" :
          authMode === "both" ?
          "Password and OIDC login enabled" :
          "OIDC settings saved"
        });
      } else {
        setOidcStatus({ type: "error", message: data.error || "Failed to save OIDC settings" });
      }
    } catch (err) {
      setOidcStatus({ type: "error", message: "An error occurred" });
    } finally {
      setOidcLoading(false);
    }
  };

  const testOidcConnection = async () => {
    const issuerUrl = oidcForm.oidcIssuerUrl.trim();
    const clientId = oidcForm.oidcClientId.trim();
    const scopes = oidcForm.oidcScopes.trim();
    const secret = oidcClientSecret.trim();

    if (!issuerUrl || !clientId) {
      setOidcTestStatus({ type: "error", message: "Issuer URL and client ID are required to test the connection." });
      return;
    }

    setOidcTestLoading(true);
    setOidcStatus({ type: "", message: "" });
    setOidcTestStatus({ type: "", message: "" });

    try {
      const saveRes = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authMode: oidcForm.authMode || settings.authMode || "password",
          oidcIssuerUrl: issuerUrl,
          oidcClientId: clientId,
          oidcScopes: scopes || "openid profile email",
          oidcLoginLabel: oidcForm.oidcLoginLabel.trim() || "Sign in with OIDC",
          ...(secret ? { oidcClientSecret: secret } : null)
        })
      });

      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        setOidcTestStatus({
          type: "error",
          message: saved.error || "Failed to save OIDC settings before testing"
        });
        return;
      }

      const res = await fetch("/api/auth/oidc/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuerUrl: saved.oidcIssuerUrl || issuerUrl,
          clientId: saved.oidcClientId || clientId,
          scopes: saved.oidcScopes || scopes || "openid profile email"
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        const statusMessage = data.clientSecretTested ?
        data.clientSecretValid === true ?
        `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret validated too.` :
        `Connection OK. Discovery loaded from ${data.issuerUrl}. Client secret was not checked.` :
        `Connection OK. Discovery loaded from ${data.issuerUrl}.`;
        setOidcTestStatus({
          type: "success",
          message: statusMessage
        });
      } else {
        setOidcTestStatus({ type: "error", message: data.error || "OIDC connection test failed" });
      }
    } catch (err) {
      setOidcTestStatus({ type: "error", message: "An error occurred" });
    } finally {
      setOidcTestLoading(false);
    }
  };

  const updateObservabilityEnabled = async (enabled) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableObservability: enabled })
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, enableObservability: enabled }));
      }
    } catch (err) {
      console.error("Failed to update enableObservability:", err);
    }
  };

  const updateProxyTimelineEnabled = async (enabled) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableProxyTimeline: enabled }),
      });
      if (res.ok) setSettings((prev) => ({ ...prev, enableProxyTimeline: enabled }));
    } catch (err) {
      console.error("Failed to update enableProxyTimeline:", err);
    }
  };

  const [retentionRunning, setRetentionRunning] = useState(false);
  const [retentionStatus, setRetentionStatus] = useState("");
  const [retentionCustomMode, setRetentionCustomMode] = useState(false);
  const [retentionCustomInput, setRetentionCustomInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/data-retention")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.lastRun) return;
        setRetentionStatus(describeRetentionRun(data.lastRun));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const updateDataRetention = async (patch) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) setSettings((prev) => ({ ...prev, ...patch }));
      else setRetentionStatus("Could not save the retention setting.");
    } catch (err) {
      console.error("Failed to update data retention settings:", err);
      setRetentionStatus("Could not save the retention setting.");
    }
  };

  const commitCustomRetentionDays = () => {
    const days = Number.parseInt(retentionCustomInput, 10);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setRetentionStatus("Enter a whole number of days between 1 and 3650.");
      return;
    }
    void updateDataRetention({ dataRetentionDays: days });
  };

  const runRetentionNow = async () => {
    setRetentionRunning(true);
    setRetentionStatus("Cleaning old data…");
    try {
      const res = await fetch("/api/data-retention", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRetentionStatus(data?.error || "Cleanup failed.");
        return;
      }
      setRetentionStatus(describeRetentionRun(data));
    } catch (err) {
      console.error("Failed to run data retention:", err);
      setRetentionStatus("Cleanup failed.");
    } finally {
      setRetentionRunning(false);
    }
  };

  const updateProxyTimelineRetention = async (value) => {
    const days = Number(value);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyTimelineRetentionDays: days }),
      });
      if (res.ok) setSettings((prev) => ({ ...prev, proxyTimelineRetentionDays: days }));
    } catch (err) {
      console.error("Failed to update proxyTimelineRetentionDays:", err);
    }
  };

  const reloadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Failed to reload settings:", err);
    }
  };

  const handleExportDatabase = async (password) => {
    setDbLoading(true);
    setDbStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/settings/database", {
        headers: { "x-9r-password": password }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to export database");
      }

      const payload = await res.json();
      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      anchor.href = url;
      anchor.download = `durindoor-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setDbStatus({ type: "success", message: "Database backup downloaded" });
    } catch (err) {
      setDbStatus({ type: "error", message: err.message || "Failed to export database" });
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = (event) => {
    const file = event.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = "";
    if (!file) return;
    pendingImportRef.current = file;
    setDbStatus({ type: "", message: "" });
    setDbAuth({ open: true, mode: "import", password: "" });
  };

  const runImportDatabase = async (password) => {
    const file = pendingImportRef.current;
    if (!file) return;
    setDbLoading(true);
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);

      const res = await fetch("/api/settings/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, password })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to import database");
      }

      await reloadSettings();
      setDbStatus({ type: "success", message: "Database imported successfully" });
    } catch (err) {
      setDbStatus({ type: "error", message: err.message || "Invalid backup file" });
    } finally {
      pendingImportRef.current = null;
      setDbLoading(false);
    }
  };

  // Confirm password modal, then run export or import.
  const handleDbAuthConfirm = async () => {
    const { mode, password } = dbAuth;
    setDbAuth({ open: false, mode: "", password: "" });
    if (mode === "export") await handleExportDatabase(password);else
    if (mode === "import") await runImportDatabase(password);
  };

  const observabilityEnabled = settings.enableObservability === true;
  const proxyTimelineEnabled = settings.enableProxyTimeline === true;
  const proxyTimelineRetentionDays = [1, 3, 7].includes(settings.proxyTimelineRetentionDays)
    ? settings.proxyTimelineRetentionDays
    : 1;
  const dataRetentionEnabled = settings.dataRetentionEnabled === true;
  const dataRetentionDays = Number.isInteger(settings.dataRetentionDays) && settings.dataRetentionDays > 0
    ? settings.dataRetentionDays
    : 30;
  const retentionPreset = retentionCustomMode || !DATA_RETENTION_PRESETS.includes(dataRetentionDays)
    ? "custom"
    : dataRetentionDays;

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {

      // Expected to fail as server shuts down; ignore error
    }setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.assign("/login");
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  const statusClass = (status) => status?.type === "error" ? "text-dd-danger" : "text-dd-success";
  const authOptions = [
    { value: "password", label: "Password only", hint: "Keep the legacy password login." },
    { value: "oidc", label: "OIDC only", hint: "Require OIDC for dashboard access." },
    { value: "both", label: "Both", hint: "Allow either password or OIDC." },
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6" aria-label="Profile settings">
      <header className="flex flex-col gap-1 border-b border-dd-border-subtle pb-5">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"><span className="material-symbols-outlined" aria-hidden="true">settings</span></span><div><h1 className="text-xl font-semibold tracking-tight text-dd-text">Settings</h1><p className="text-[13px] text-dd-muted">Local dashboard, routing, and service preferences</p></div></div>
      </header>

      <Card padding={false}><CardHeader icon="computer" title="Local Mode" subtitle="Appearance, local data, and backups" /><CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 border-b border-dd-border-subtle pb-5 sm:flex-row sm:items-center sm:justify-between"><Field group className="flex-1" label="Theme" hint="Choose how DurinDoor looks on this device."><SegmentedControl aria-label="Theme" options={[{value:"light",label:"Light"},{value:"dark",label:"Dark"},{value:"system",label:"System"}]} value={theme} onChange={setTheme} /></Field></div>
        <div className="flex flex-col gap-3 border-b border-dd-border-subtle pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[13px] font-medium text-dd-text">Database location</p><p className="break-all font-mono text-xs text-dd-muted">~/.9router/db/data.sqlite (DurinDoor data directory)</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" icon="download" onClick={() => setDbAuth({ open: true, mode: "export", password: "" })} loading={dbLoading}>Download Backup</Button><Button variant="secondary" icon="upload" onClick={() => importFileRef.current?.click()} disabled={dbLoading}>Import Backup</Button><input ref={importFileRef} tabIndex={-1} aria-label="Import database backup" type="file" accept="application/json,.json" className="sr-only" onChange={handleImportDatabase} /></div></div>
        {dbStatus.message ? <p role="status" className={`text-xs ${statusClass(dbStatus)}`}>{dbStatus.message}</p> : null}<SelectiveTransferPanel />
      </CardContent></Card>

      <Card padding={false}><CardHeader icon="language" title="Language" subtitle="Regional display preferences" /><CardContent><button type="button" onClick={() => setLangOpen(true)} data-i18n-skip="true" className="flex min-h-11 w-full items-center justify-between rounded-dd border border-dd-border bg-dd-surface-2 px-3 text-left text-[13px] text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"><span>Display language</span><span role="img" aria-label={locale} className="text-xl">{LOCALE_FLAGS[locale] || "🌐"}</span></button></CardContent></Card>

      <Card padding={false}><CardHeader icon="view_list" title="Model catalog" subtitle="Control model discovery and selectors" /><CardContent className="divide-y divide-dd-border-subtle"><div className="pb-4"><Toggle label="Expose combos only" description="When ON, /v1/models lists only configured combo names." checked={settings.exposeComboOnly === true} disabled={loading} onChange={() => updateExposeComboOnly(!(settings.exposeComboOnly === true))} /></div><div className="pt-4"><Toggle label="Hide paid models" description="When ON, /v1/models, dashboard pickers, and combo pools only show free or unpriced models." checked={settings.hidePaidModels === true} disabled={loading} onChange={() => updateHidePaidModels(!(settings.hidePaidModels === true))} /></div></CardContent></Card>

      <Card padding={false}><CardHeader icon="shield_lock" title="Security" subtitle="Protect access to this dashboard" /><CardContent className="flex flex-col gap-5"><Toggle label="Require login" description="When ON, dashboard requires password. When OFF, access without login." checked={settings.requireLogin === true} onChange={() => updateRequireLogin(!settings.requireLogin)} disabled={loading} />{settings.requireLogin === true ? <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 border-t border-dd-border-subtle pt-5"><div className="grid gap-4 md:grid-cols-3"><Input id="profile-current-password" label="Current password" type="password" placeholder="Enter current password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} required /><Input id="profile-new-password" label="New password" type="password" placeholder="Enter new password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} required /><Input id="profile-confirm-password" label="Confirm password" type="password" placeholder="Confirm new password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} required /></div>{passStatus.message ? <p role="status" className={`text-xs ${statusClass(passStatus)}`}>{passStatus.message}</p> : null}<div><Button type="submit" variant="primary" loading={passLoading}>{settings.hasPassword ? "Update Password" : "Set Password"}</Button></div></form> : null}</CardContent></Card>

      <Card padding={false}><CardHeader icon="badge" title="OIDC Dashboard Login" subtitle={settings.authMode === "oidc" ? "OIDC active" : settings.authMode === "both" ? "Password + OIDC active" : "Optional SSO via Authentik, Keycloak, or Google"} actions={<Button variant="ghost" icon={oidcExpanded ? "expand_less" : "expand_more"} aria-label="Toggle OIDC settings" onClick={() => setOidcExpanded((v) => !v)} />} />{oidcExpanded ? <CardContent className="flex flex-col gap-5"><Field group label="Auth mode" hint="Choose password login, OIDC, or both."><SegmentedControl aria-label="Auth mode" options={authOptions} value={oidcForm.authMode} onChange={(value) => updateOidcForm("authMode", value)} disabled={loading || oidcLoading} /></Field><div className="grid gap-4 md:grid-cols-2"><Input label="Issuer URL" placeholder="https://auth.example.com/application/o/durindoor/" value={oidcForm.oidcIssuerUrl} onChange={(e) => updateOidcForm("oidcIssuerUrl", e.target.value)} disabled={loading || oidcLoading} /><Input label="Client ID" placeholder="durindoor-dashboard" value={oidcForm.oidcClientId} onChange={(e) => updateOidcForm("oidcClientId", e.target.value)} disabled={loading || oidcLoading} /><Input label="Client Secret" hint="This value is write-only after saving." type="password" placeholder="Leave blank to keep existing secret" value={oidcClientSecret} onChange={(e) => setOidcClientSecret(e.target.value)} disabled={loading || oidcLoading} /><Input label="Scopes" placeholder="openid profile email" value={oidcForm.oidcScopes} onChange={(e) => updateOidcForm("oidcScopes", e.target.value)} disabled={loading || oidcLoading} /><div className="md:col-span-2"><Input label="Login Button Label" placeholder="Sign in with OIDC" value={oidcForm.oidcLoginLabel} onChange={(e) => updateOidcForm("oidcLoginLabel", e.target.value)} disabled={loading || oidcLoading} /></div></div><div className="rounded-dd bg-dd-surface-2 p-3"><p className="text-xs font-medium text-dd-muted">Redirect URI</p><code className="block break-all font-mono text-xs text-dd-text">{oidcRedirectUri}</code></div><div className="flex flex-wrap gap-2"><Button variant="primary" loading={oidcLoading} onClick={() => saveOidcSettings()}>Save auth mode</Button><Button variant="secondary" loading={oidcTestLoading} onClick={testOidcConnection}>Test connection</Button></div>{oidcTestStatus.message ? <p role="status" className={`text-xs ${statusClass(oidcTestStatus)}`}>{oidcTestStatus.message}</p> : null}{oidcStatus.message ? <p role="status" className={`text-xs ${statusClass(oidcStatus)}`}>{oidcStatus.message}</p> : null}{settings.authMode === "oidc" ? <p className="text-xs text-dd-warning">OIDC login is active. Password login is disabled until you switch back.</p> : null}{settings.authMode === "both" ? <p className="text-xs text-dd-warning">Password and OIDC login are both active.</p> : null}</CardContent> : null}</Card>

      <Card padding={false}><CardHeader icon="route" title="Routing Strategy" subtitle="Defaults used when DurinDoor selects an upstream model" /><CardContent className="flex flex-col gap-5"><Toggle label="Round Robin" description="Cycle through accounts to distribute load." checked={settings.fallbackStrategy === "round-robin"} onChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")} disabled={loading} />{settings.fallbackStrategy === "round-robin" ? <Input label="Sticky Limit" hint="Calls per account before switching." type="number" min="1" max="10" value={settings.stickyRoundRobinLimit || 3} onChange={(e) => updateStickyLimit(e.target.value)} disabled={loading} /> : null}<Toggle label="Combo Round Robin" description="Cycle through providers in combos instead of always starting with first." checked={settings.comboStrategy === "round-robin"} onChange={() => updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")} disabled={loading} />{settings.comboStrategy === "round-robin" ? <Input label="Combo Sticky Limit" hint="Calls per combo model before switching." type="number" min="1" max="100" value={settings.comboStickyRoundRobinLimit || 1} onChange={(e) => updateComboStickyLimit(e.target.value)} disabled={loading} /> : null}<Input id="vision-bridge-model-input" label="Vision Model" hint="Target as provider/model. Empty or invalid keeps original model." placeholder="openai/gpt-4o" key={settings.visionBridgeModel || ""} defaultValue={settings.visionBridgeModel || ""} onBlur={(e) => updateVisionBridge({ visionBridgeModel: e.target.value.trim() })} disabled={loading} /><Toggle label="Vision Bridge" description="Reroute image-bearing requests on a text-only model to this vision model." checked={settings.visionBridgeEnabled === true} onChange={handleVisionBridgeToggle} disabled={loading} /><p className="border-t border-dd-border-subtle pt-4 text-xs text-dd-muted">{settings.fallbackStrategy === "round-robin" ? `Currently distributing requests with ${settings.stickyRoundRobinLimit || 3} calls per account.` : "Currently using accounts in priority order (Fill First)."}{settings.comboStrategy === "round-robin" ? ` Combos rotate after ${settings.comboStickyRoundRobinLimit || 1} calls per model.` : " Combos always start with their first model."}</p></CardContent></Card>

      <Card padding={false}><CardHeader icon="lan" title="Network" subtitle="Outbound services and proxy behavior" /><CardContent className="flex flex-col gap-5"><Toggle label="Outbound Proxy" description="Enable proxy for OAuth and provider outbound requests." checked={settings.outboundProxyEnabled === true} onChange={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))} disabled={loading || proxyLoading} />{settings.outboundProxyEnabled === true ? <form onSubmit={updateOutboundProxy} className="flex flex-col gap-4 border-t border-dd-border-subtle pt-5"><Input label="Proxy URL" hint="Leave empty to inherit existing environment proxy." placeholder="http://127.0.0.1:7897" value={proxyForm.outboundProxyUrl} onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundProxyUrl: e.target.value }))} disabled={loading || proxyLoading} /><Input label="No Proxy" hint="Comma-separated hostnames or domains to bypass proxy." placeholder="localhost,127.0.0.1" value={proxyForm.outboundNoProxy} onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundNoProxy: e.target.value }))} disabled={loading || proxyLoading} /><div className="flex flex-wrap gap-2"><Button variant="secondary" loading={proxyTestLoading} disabled={loading || proxyLoading} onClick={testOutboundProxy}>Test proxy URL</Button><Button type="submit" variant="primary" loading={proxyLoading}>Apply</Button></div></form> : null}{proxyStatus.message ? <p role="status" className={`text-xs ${statusClass(proxyStatus)}`}>{proxyStatus.message}</p> : null}<form onSubmit={updateFirecrawlUrl} className="flex flex-col gap-3 border-t border-dd-border-subtle pt-5"><Input label="Firecrawl URL" hint="Custom Firecrawl or self-hosted endpoint. Falls back to FIRECRAWL_BASE_URL." placeholder="https://api.firecrawl.dev" value={firecrawlUrl} onChange={(e) => setFirecrawlUrl(e.target.value)} disabled={loading || firecrawlUrlLoading} /><div><Button type="submit" variant="primary" loading={firecrawlUrlLoading}>Save</Button></div>{firecrawlUrlStatus.message ? <p role="status" className={`text-xs ${statusClass(firecrawlUrlStatus)}`}>{firecrawlUrlStatus.message}</p> : null}</form></CardContent></Card>

      <Card padding={false}><CardHeader icon="monitoring" title="Observability" subtitle="Local request diagnostics and retention" /><CardContent className="flex flex-col gap-5"><Toggle label="Enable Observability" description="Record request details for inspection in logs view." checked={observabilityEnabled} onChange={updateObservabilityEnabled} disabled={loading} /><Toggle label="Proxy timeline" description="Capture redacted hops in a sidecar database. Secrets stay redacted." checked={proxyTimelineEnabled} onChange={updateProxyTimelineEnabled} disabled={loading} /><Field label="Timeline retention" hint="Days to keep sidecar traces."><Select aria-label="Timeline retention" options={[{value:1,label:"1 day"},{value:3,label:"3 days"},{value:7,label:"7 days"}]} value={proxyTimelineRetentionDays} disabled={loading || !proxyTimelineEnabled} onChange={updateProxyTimelineRetention} /></Field>
        <div className="flex flex-col gap-4 border-t border-dd-border-subtle pt-5">
          <Toggle label="Auto-clean old data" description="Every hour, delete usage history, request details, timeline traces and quota snapshots older than the window below." checked={dataRetentionEnabled} onChange={(value) => updateDataRetention({ dataRetentionEnabled: value === true })} disabled={loading} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field label="Keep data for" hint="Older records are removed automatically while auto-clean is on.">
              <Select
                aria-label="Data retention window"
                options={[...DATA_RETENTION_PRESETS.map((days) => ({ value: days, label: `${days} days` })), { value: "custom", label: "Custom" }]}
                value={retentionPreset}
                disabled={loading}
                onChange={(value) => {
                  if (value === "custom") { setRetentionCustomMode(true); setRetentionCustomInput(String(dataRetentionDays)); return; }
                  setRetentionCustomMode(false);
                  void updateDataRetention({ dataRetentionDays: Number(value) });
                }}
              />
            </Field>
            {retentionPreset === "custom" ? (
              <Field label="Days" hint="1 to 3650.">
                <Input type="number" min="1" max="3650" inputMode="numeric" aria-label="Custom retention days" className="w-28" value={retentionCustomInput} onChange={(event) => setRetentionCustomInput(event.target.value)} onBlur={commitCustomRetentionDays} onKeyDown={(event) => { if (event.key === "Enter") commitCustomRetentionDays(); }} />
              </Field>
            ) : null}
            <Button variant="secondary" icon="cleaning_services" className="sm:mt-6" onClick={runRetentionNow} disabled={loading || retentionRunning}>{retentionRunning ? "Cleaning…" : "Clean now"}</Button>
          </div>
          {retentionStatus ? <p role="status" className="text-xs text-dd-muted">{retentionStatus}</p> : null}
        </div>
      </CardContent></Card>

      <Card padding={false}><CardFooter className="flex-col items-stretch sm:flex-row"><div className="flex flex-wrap gap-2"><Button variant="danger" icon="power_settings_new" onClick={() => setShutdownOpen(true)}>Shutdown</Button><Button variant="secondary" icon="logout" onClick={handleLogout}>Logout</Button></div><div className="sm:ml-auto sm:text-right"><p className="dd-tnum text-xs font-medium text-dd-text">{APP_CONFIG.name} v{APP_CONFIG.version}</p><p className="text-xs text-dd-muted">{isRemoteHost ? "Remote Mode" : "Local Mode - All data stored on your machine"}</p></div></CardFooter></Card>
      <LanguageSwitcher hideTrigger isOpen={langOpen} onClose={(next) => { setLangOpen(false); setLocale(next); }} />
      <ConfirmDialog open={shutdownOpen} pending={isShuttingDown} onCancel={() => setShutdownOpen(false)} onConfirm={handleShutdown} title="Close Proxy" message="Are you sure you want to close the proxy server?" confirmLabel="Close" cancelLabel="Cancel" tone="danger" />
      <Modal open={dbAuth.open} onClose={() => setDbAuth({ open: false, mode: "", password: "" })} title="Confirm Password" size="sm" pending={dbLoading} footer={<><Button variant="secondary" onClick={() => setDbAuth({ open: false, mode: "", password: "" })} disabled={dbLoading}>Cancel</Button><Button variant="primary" onClick={handleDbAuthConfirm} loading={dbLoading} disabled={!dbAuth.password}>Confirm</Button></>}><div className="flex flex-col gap-3"><p className="text-[13px] text-dd-muted">Enter your current password to {dbAuth.mode === "export" ? "export" : "import"} the database.</p><Input type="password" value={dbAuth.password} onChange={(e) => setDbAuth((state) => ({ ...state, password: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && dbAuth.password) handleDbAuthConfirm(); }} placeholder="Current password" autoFocus /></div></Modal>
    </main>
  );
}
