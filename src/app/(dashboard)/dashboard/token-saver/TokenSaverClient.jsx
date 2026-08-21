"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Modal, Toggle } from "@/shared/components";
import TokenSaverOverview from "./components/TokenSaverOverview";
import PxpipeClient from "../pxpipe/PxpipeClient";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import SetupDiagnosticCard from "@/shared/components/SetupDiagnosticCard";
import {
  externalInstallNote,
  formatExtrasSummary,
  installActionLabel,
  reportFetchOutcome,
  shouldShowExternalInstallNote,
  sourceLabel,
} from "@/shared/utils/setupDiagnosticView";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";
import { fetchPxpipeStatus, getPxpipeStatusView } from "../pxpipe/pxpipeStatus.js";

export default function TokenSaverClient({ view = "overview" }) {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [pxpipeEnabled, setPxpipeEnabled] = useState(false);
  const [pxpipeMinChars, setPxpipeMinChars] = useState("25000");
  const [pxpipeInputValue, setPxpipeInputValue] = useState("25000");
  const [pxpipeMinCharsError, setPxpipeMinCharsError] = useState("");
  const [pxpipeTimeoutMs, setPxpipeTimeoutMs] = useState("15000");
  const [pxpipeTimeoutInputValue, setPxpipeTimeoutInputValue] = useState("15000");
  const [pxpipeTimeoutError, setPxpipeTimeoutError] = useState("");
  const [pxpipeAllowedModelsInputValue, setPxpipeAllowedModelsInputValue] = useState("");
  const [pxpipeAllowedModels, setPxpipeAllowedModels] = useState([]);
  const [pxpipeBlockedModels, setPxpipeBlockedModels] = useState([]);
  const [pxpipeStatus, setPxpipeStatus] = useState({
    installed: false,
    installing: false,
    running: false,
    version: null,
    loading: true,
  });
  const [pxpipeHealth, setPxpipeHealth] = useState(null);
  const [pxpipeActionLoading, setPxpipeActionLoading] = useState(false);
  const [pxpipeActionError, setPxpipeActionError] = useState("");
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true,
  });
  const [showHeadroomInstallModal, setShowHeadroomInstallModal] =
    useState(false);
  const [headroomActionLoading, setHeadroomActionLoading] = useState(false);
  const [headroomActionError, setHeadroomActionError] = useState("");
  const [headroomDiagnostic, setHeadroomDiagnostic] = useState(null);
  const [headroomExtras, setHeadroomExtras] = useState({
    version: null,
    extras: { code: false, ml: false },
    available: ["code", "ml"],
    loading: false,
  });
  const [extrasActionLoading, setExtrasActionLoading] = useState(false);
  const [extrasActionError, setExtrasActionError] = useState("");
  const [extrasDiagnostic, setExtrasDiagnostic] = useState(null);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [locale, setLocale] = useState("en");

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    setLocale(getCurrentLocale());
    return onLocaleChange(() => setLocale(getCurrentLocale()));
  }, []);

  const isWenyanLocale = WENYAN_LOCALES.includes(locale);
  const visibleCavemanLevels = isWenyanLocale
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

  useEffect(() => {
    const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel);
    if (current?.wenyan && !isWenyanLocale) {
      setCavemanLevel("ultra");
      patchSetting({ cavemanLevel: "ultra" });
    }
  }, [isWenyanLocale, cavemanLevel]);

  /**
   * PATCH one or more settings. Returns the fetch Response (or null on
   * network error) so callers can revert optimistic local state on !res.ok.
   */
  const patchSetting = async (patch) => {
    try {
      return await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating setting:", error);
      return null;
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleHeadroomEnabled = (value) => {
    const nextUrl = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(nextUrl);
    setHeadroomEnabled(value);
    patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleHeadroomUrlBlur = async () => {
    const next = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(next);
    await patchSetting({ headroomUrl: next });
    refreshHeadroomStatus();
  };

  const refreshHeadroomStatus = useCallback(async () => {
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json().catch(() => ({}));
      // GET /status is a REPORT, not an action: a 200 carrying a diagnostic
      // (NOT_INSTALLED being the common one) still has a valid payload. Zeroing
      // the state here made an installed-and-running proxy read as "not
      // installed" and hid the very panel that offers the repair. The rule lives
      // in reportFetchOutcome so it is unit-tested rather than implied.
      const outcome = reportFetchOutcome(res.ok, data);
      setHeadroomDiagnostic(outcome.diagnostic);
      if (outcome.resetState) {
        setHeadroomStatus({ installed: false, running: false, python: null, loading: false });
        return;
      }
      setHeadroomStatus({ ...data, loading: false });
      // Load extras even when nothing is installed: that payload carries the
      // provenance and the external-install note, and it is what the install
      // action renders from. Returning early left a dead end on a fresh host.
      const extrasResponse = await fetch("/api/headroom/extras", { headers: { "Cache-Control": "no-store" } });
      const extras = await extrasResponse.json().catch(() => ({}));
      if (!extrasResponse.ok) {
        setExtrasDiagnostic(extras.diagnostic || null);
        setHeadroomExtras((current) => ({ ...current, loading: false }));
        return;
      }
      setExtrasDiagnostic(extras.diagnostic || null);
      setHeadroomExtras((current) => ({
        ...current,
        installed: extras.installed ?? false,
        version: extras.version ?? null,
        extras: extras.extras || { code: false, ml: false },
        available: extras.available || ["code", "ml"],
        source: extras.source,
        externalInstall: extras.externalInstall,
        loading: false,
      }));
    } catch (error) {
      setHeadroomActionError(error.message || "Unable to reach the Headroom service");
      setHeadroomStatus({ installed: false, running: false, python: null, loading: false });
    }
  }, []);

  const handleHeadroomStart = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomDiagnostic(null);
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.diagnostic) {
        setHeadroomDiagnostic(data.diagnostic || null);
        if (!data.diagnostic) setHeadroomActionError(data.error || "Failed to start proxy");
        return;
      }
      await refreshHeadroomStatus();
    } catch (error) {
      setHeadroomActionError(error.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleHeadroomStop = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomDiagnostic(null);
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/stop", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.diagnostic) {
        setHeadroomDiagnostic(data.diagnostic || null);
        if (!data.diagnostic) setHeadroomActionError(data.error || "Failed to stop proxy");
        return;
      }
      await refreshHeadroomStatus();
    } catch (error) {
      setHeadroomActionError(error.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleInstallExtras = useCallback(async () => {
    setExtrasActionLoading(true);
    setExtrasActionError("");
    setExtrasDiagnostic(null);
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: ["code", "ml"] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.diagnostic) {
        setExtrasDiagnostic(data.diagnostic || null);
        if (!data.diagnostic) setExtrasActionError(data.error || "Install failed");
        return;
      }
      await refreshHeadroomStatus();
    } catch (error) {
      setExtrasActionError(error.message);
    } finally {
      setExtrasActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  const refreshPxpipeStatus = useCallback(async () => {
    setPxpipeStatus((s) => ({ ...s, loading: true, error: null }));
    const data = await fetchPxpipeStatus();
    setPxpipeStatus(data);
    if (typeof data.minChars === "number") {
      const v = String(data.minChars);
      setPxpipeMinChars(v);
      setPxpipeInputValue(v);
    }
  }, []);

  const runPxpipeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/pxpipe/health", { method: "POST" });
      setPxpipeHealth(await res.json());
    } catch (e) {
      setPxpipeHealth({ healthy: false, checks: [], error: e.message });
    }
  }, []);

  /**
   * Pull recent PXPIPE transform events and surface the distinct models that
   * were rejected as "unsupported_model" (not in the allowlist). These become
   * one-click quick-add suggestions so the operator doesn't have to hand-copy
   * model ids out of the History table.
   */
  const refreshPxpipeBlockedModels = useCallback(async () => {
    try {
      const res = await fetch("/api/pxpipe/logs?limit=200", { headers: { "Cache-Control": "no-store" } });
      if (!res.ok) return;
      const data = await res.json();
      const events = Array.isArray(data?.events) ? data.events : [];
      const seen = new Set();
      const blocked = [];
      for (const ev of events) {
        if (ev?.reason !== "unsupported_model" || !ev?.model) continue;
        const id = ev.model;
        if (seen.has(id)) continue;
        seen.add(id);
        blocked.push(id);
      }
      setPxpipeBlockedModels(blocked);
    } catch {
      /* non-fatal: quick-add suggestions are best-effort */
    }
  }, []);

  const pxpipeAction = useCallback(async (endpoint) => {
    setPxpipeActionError("");
    setPxpipeActionLoading(true);
    try {
      const res = await fetch(`/api/pxpipe/${endpoint}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `PXPIPE ${endpoint} failed`);
      await refreshPxpipeStatus();
      await runPxpipeHealth();
    } catch (e) {
      setPxpipeActionError(e.message);
    } finally {
      setPxpipeActionLoading(false);
    }
  }, [refreshPxpipeStatus, runPxpipeHealth]);

  /**
   * Toggle PXPIPE optimistically; revert local state if the PATCH is
   * rejected (e.g. validation 400) or the request fails.
   */
  const handlePxpipeEnabled = async (value) => {
    setPxpipeEnabled(value);
    const res = await patchSetting({ pxpipeEnabled: value });
    if (!res?.ok) setPxpipeEnabled(!value);
  };

  const handlePxpipeMinChars = (value) => {
    setPxpipeInputValue(value);
    setPxpipeMinCharsError("");
  };

  /** Persist pxpipeMinChars on blur; show inline error on invalid input. */
  const handlePxpipeMinCharsBlur = () => {
    if (pxpipeInputValue === "") {
      setPxpipeInputValue(pxpipeMinChars);
      return;
    }
    const n = Number(pxpipeInputValue);
    if (Number.isSafeInteger(n) && n > 0) {
      setPxpipeMinChars(pxpipeInputValue);
      setPxpipeMinCharsError("");
      patchSetting({ pxpipeMinChars: n });
    } else {
      setPxpipeInputValue(pxpipeMinChars);
      setPxpipeMinCharsError("Must be a positive whole number");
    }
  };

  /** Persist a new allowlist (dedup, trim) and keep array + input string in sync. */
  const persistPxpipeAllowedModels = (nextArray) => {
    const cleaned = Array.from(new Set(nextArray.map((m) => m.trim()).filter(Boolean)));
    setPxpipeAllowedModels(cleaned);
    setPxpipeAllowedModelsInputValue(cleaned.join(", "));
    patchSetting({ pxpipeAllowedModels: cleaned });
  };

  /** Persist pxpipeAllowedModels on blur; normalize to string array. */
  const handlePxpipeAllowedModelsBlur = () => {
    persistPxpipeAllowedModels(pxpipeAllowedModelsInputValue.split(","));
  };

  const handlePxpipeAllowedModelsChange = (value) => {
    setPxpipeAllowedModelsInputValue(value);
  };

  const addPxpipeAllowedModel = (modelId) => {
    if (!modelId || pxpipeAllowedModels.includes(modelId)) return;
    persistPxpipeAllowedModels([...pxpipeAllowedModels, modelId]);
  };

  const removePxpipeAllowedModel = (modelId) => {
    persistPxpipeAllowedModels(pxpipeAllowedModels.filter((m) => m !== modelId));
  };
  const handlePxpipeTimeoutBlur = () => {
    if (pxpipeTimeoutInputValue === "") {
      setPxpipeTimeoutInputValue(pxpipeTimeoutMs);
      return;
    }
    const n = Number(pxpipeTimeoutInputValue);
    if (Number.isSafeInteger(n) && n >= 1000 && n <= 120000) {
      setPxpipeTimeoutMs(pxpipeTimeoutInputValue);
      setPxpipeTimeoutError("");
      patchSetting({ pxpipeTimeoutMs: n });
    } else {
      setPxpipeTimeoutInputValue(pxpipeTimeoutMs);
      setPxpipeTimeoutError("Must be a whole number 1000–120000");
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setRtkEnabledState(data.rtkEnabled !== false);
          setHeadroomEnabled(!!data.headroomEnabled);
          setHeadroomUrl(data.headroomUrl || "http://localhost:8787");
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
          setPonytailEnabled(!!data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || "full");
          setPxpipeEnabled(!!data.pxpipeEnabled);
          setPxpipeMinChars(String(data.pxpipeMinChars ?? 25000));
          setPxpipeInputValue(String(data.pxpipeMinChars ?? 25000));
          setPxpipeTimeoutMs(String(data.pxpipeTimeoutMs ?? 15000));
          setPxpipeTimeoutInputValue(String(data.pxpipeTimeoutMs ?? 15000));
          const allowed = Array.isArray(data.pxpipeAllowedModels) ? data.pxpipeAllowedModels : [];
          setPxpipeAllowedModels(allowed);
          setPxpipeAllowedModelsInputValue(allowed.join(", "));
          refreshHeadroomStatus();
          refreshPxpipeStatus();
          refreshPxpipeBlockedModels();
        }
      } catch {}
    };
    loadSettings();
  }, [refreshHeadroomStatus, refreshPxpipeStatus, refreshPxpipeBlockedModels]);

  const headroomRunning = !!headroomStatus.running;
  const headroomStatusLabel = headroomStatus.loading
    ? "Checking…"
    : headroomRunning
      ? "Running"
      : headroomStatus.localUrl !== false && !headroomStatus.installed
        ? "Not installed"
        : headroomStatus.localUrl !== false
          ? "Stopped"
          : "External";
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
    headroomLocalUrl && !!headroomStatus.managedPid;
  const pxpipeStatusView = getPxpipeStatusView(pxpipeStatus, pxpipeHealth);
  const pxpipeStatusLabel = pxpipeStatusView.label;

  return (
    <div className="space-y-6 p-6">
      {view === "overview" ? (
        <>
          <TokenSaverOverview />
          <PxpipeClient embedded />
        </>
      ) : <>
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">
              bolt
            </span>
            Token Saver
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress tool output{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              git/grep/ls/tree/logs → 60-90% fewer input tokens
            </p>
          </div>
          <Toggle
            checked={rtkEnabled}
            onChange={() => handleRtkEnabled(!rtkEnabled)}
          />
        </div>
        <div className="flex items-center justify-between py-4 border-b border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="font-medium">
                Compress context{" "}
                <a
                  href="https://github.com/chopratejas/headroom"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-normal text-primary underline hover:opacity-80"
                >
                  (Headroom)
                </a>
              </p>
              <span
                className={`text-xs px-2 py-0.5 rounded ${headroomRunning ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
              >
                {headroomStatusLabel}
              </span>
              <a
                href="/dashboard/headroom"
                className="text-xs text-primary underline hover:opacity-80"
              >
                Open full page →
              </a>
              <button
                type="button"
                onClick={() => setShowHeadroomInstallModal(true)}
                className="text-xs text-primary underline hover:opacity-80"
              >
                {headroomRunning ? "Manage" : "Setup"}
              </button>
            </div>
            <p className="text-sm text-text-muted mt-1">
              Compress prompts via /v1/compress before routing to the model
            </p>
          </div>
          <Toggle
            ariaLabel="Enable Headroom"
            checked={headroomEnabled}
            onChange={() => handleHeadroomEnabled(!headroomEnabled)}
          />
        </div>
        {headroomDiagnostic && (
          <SetupDiagnosticCard
            diagnostic={headroomDiagnostic}
            onRetry={refreshHeadroomStatus}
            className="mt-3"
          />
        )}
        {headroomStatus.installed && (
          <div className="mt-3 ml-1 pl-3 border-l-2 border-border space-y-2">
            <p className="text-xs text-text-muted">
              Source: {sourceLabel(headroomStatus.source || headroomExtras.source || null)}
              {headroomExtras.version ? ` · v${headroomExtras.version}` : ""}
            </p>
            <p className="text-xs text-text-muted">
              {formatExtrasSummary(headroomExtras.extras)}
            </p>
            {shouldShowExternalInstallNote(headroomExtras) && (
              <p className="text-xs text-text-muted">
                {externalInstallNote(headroomExtras.externalInstall)}
                {headroomExtras.externalInstall?.uninstallCommand ? (
                  <>
                    <code className="ml-1 break-all rounded bg-surface px-1 py-0.5">
                      {headroomExtras.externalInstall.uninstallCommand}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2"
                      onClick={() => copy(headroomExtras.externalInstall.uninstallCommand, "external-install-uninstall")}
                    >
                      {copied === "external-install-uninstall" ? "Copied" : "Copy"}
                    </Button>
                  </>
                ) : (
                  <span className="ml-1">Remove it with whichever tool manager installed it.</span>
                )}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={handleInstallExtras}
                disabled={extrasActionLoading}
                size="sm"
              >
                {extrasActionLoading
                  ? "Installing…"
                  : installActionLabel({ installed: headroomStatus.installed, extras: headroomExtras.extras })}
              </Button>
              <span className="text-xs text-text-muted">
                ml downloads torch and can take several minutes.
              </span>
            </div>
            {extrasDiagnostic ? (
              <SetupDiagnosticCard
                diagnostic={extrasDiagnostic}
                onRetry={refreshHeadroomStatus}
              />
            ) : (
              extrasActionError && (
                <p className="text-xs text-error mt-1">{extrasActionError}</p>
              )
            )}
          </div>
        )}
        <div className="flex items-center justify-between pt-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress LLM output{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Terse-style system prompt → ~65% fewer output tokens (up to 87%)
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {cavemanEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {visibleCavemanLevels.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handleCavemanLevel(lvl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        cavemanLevel === lvl.id
                          ? "bg-primary text-white border-primary"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={cavemanEnabled}
              onChange={() => handleCavemanEnabled(!cavemanEnabled)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Lazy senior dev{" "}
              <a
                href="https://github.com/DietrichGebert/ponytail"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Ponytail)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Bias the model toward minimal code: YAGNI, reuse stdlib,
              deletion over addition
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {ponytailEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {PONYTAIL_LEVELS.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handlePonytailLevel(lvl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        ponytailLevel === lvl.id
                          ? "bg-primary text-white border-primary"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    PONYTAIL_LEVELS.find((lvl) => lvl.id === ponytailLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={ponytailEnabled}
              onChange={() => handlePonytailEnabled(!ponytailEnabled)}
            />
          </div>
        </div>
      </Card>

      <Card id="pxpipe">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">image</span>
            PXPIPE
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Compress bulky Claude context into images</p>
            <p className="text-sm text-text-muted">
              Renders large text context as dense PNGs for vision-capable models. Fail-open.
            </p>
          </div>
          <div className="shrink-0" title={pxpipeStatusView.dependencyMissing ? "Install PXPIPE first" : undefined}>
            <Toggle
              checked={pxpipeEnabled}
              disabled={pxpipeStatusView.dependencyMissing}
              onChange={() => handlePxpipeEnabled(!pxpipeEnabled)}
            />
          </div>
        </div>
        <div className="pt-4 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium">Status</p>
              <p className="text-sm text-text-muted">
                {pxpipeStatusLabel}
                {pxpipeStatus.version ? ` · v${pxpipeStatus.version}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {pxpipeStatusView.error ? (
                <p className="text-sm text-warning max-w-64">
                  PXPIPE status unavailable: {pxpipeStatusView.error}
                </p>
              ) : pxpipeStatusView.dependencyMissing ? (
                <p className="text-sm text-warning max-w-64">
                  PXPIPE dependency missing. Reinstall the application
                  (npm install) to restore it.
                </p>
              ) : pxpipeStatus.running ? (
                <Button
                  onClick={() => pxpipeAction("stop")}
                  variant="ghost"
                  disabled={pxpipeActionLoading}
                  size="sm"
                >
                  {pxpipeActionLoading ? "Stopping…" : "Stop"}
                </Button>
              ) : (
                <Button
                  onClick={() => pxpipeAction("start")}
                  disabled={pxpipeActionLoading}
                  size="sm"
                >
                  {pxpipeActionLoading ? "Starting…" : "Start"}
                </Button>
              )}
              {pxpipeStatus.installed && (
                <Button
                  onClick={() => pxpipeAction("restart")}
                  variant="ghost"
                  disabled={pxpipeActionLoading}
                  size="sm"
                >
                  Restart
                </Button>
              )}
              <Button
                onClick={() => {
                  refreshPxpipeStatus();
                  runPxpipeHealth();
                }}
                variant="ghost"
                disabled={pxpipeStatus.loading}
                size="sm"
              >
                Recheck
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-text-muted shrink-0">Min chars</label>
            <Input
              type="number"
              min="1"
              step="1"
              value={pxpipeInputValue}
              onChange={(e) => handlePxpipeMinChars(e.target.value)}
              onBlur={handlePxpipeMinCharsBlur}
              className="w-32 text-sm"
            />
          </div>
          {pxpipeMinCharsError && (
            <p className="text-sm text-warning">{pxpipeMinCharsError}</p>
          )}
          <div className="flex items-center gap-3">
            <label className="text-sm text-text-muted shrink-0">Timeout (ms)</label>
            <Input
              type="number"
              min="1000"
              max="120000"
              step="1000"
              value={pxpipeTimeoutInputValue}
              onChange={(e) => {
                setPxpipeTimeoutInputValue(e.target.value);
                setPxpipeTimeoutError("");
              }}
              onBlur={handlePxpipeTimeoutBlur}
              className="w-32 text-sm"
            />
          </div>
          {pxpipeTimeoutError && (
            <p className="text-sm text-warning">{pxpipeTimeoutError}</p>
          )}
          <div className="flex flex-col gap-2">
            <label className="text-sm text-text-muted">Allowed models</label>
            <p className="text-xs text-text-muted max-w-xl">
              PXPIPE only shrinks image payloads for models on this allowlist; every
              other model passes through untouched and is logged as{" "}
              <span className="text-warning">Model not in allowlist</span> in History.
              Empty leaves the built-in safe default (Claude Fable only).
            </p>
            {pxpipeAllowedModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pxpipeAllowedModels.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5 font-mono"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => removePxpipeAllowedModel(m)}
                      aria-label={`Remove ${m} from allowlist`}
                      className="hover:text-danger transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px] leading-none">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              type="text"
              placeholder="claude-fable-5, blackboxai/anthropic/claude-fable-5"
              value={pxpipeAllowedModelsInputValue}
              onChange={(e) => handlePxpipeAllowedModelsChange(e.target.value)}
              onBlur={handlePxpipeAllowedModelsBlur}
              className="w-full max-w-md text-sm"
            />
            <p className="text-xs text-text-muted">
              Type comma-separated model ids, or use the quick-add buttons below. Changes save on blur.
            </p>
            {pxpipeBlockedModels.filter((m) => !pxpipeAllowedModels.includes(m)).length > 0 && (
              <div className="flex flex-col gap-1.5 pt-1">
                <span className="text-xs text-text-muted">Recently blocked (click to allow):</span>
                <div className="flex flex-wrap gap-1.5">
                  {pxpipeBlockedModels
                    .filter((m) => !pxpipeAllowedModels.includes(m))
                    .map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => addPxpipeAllowedModel(m)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 text-xs px-2 py-0.5 font-mono text-text-muted hover:text-primary hover:border-primary transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px] leading-none">add</span>
                        {m}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
          {pxpipeHealth && (
            <p className={`text-sm ${pxpipeHealth.healthy ? "text-success" : "text-warning"}`}>
              Health: {pxpipeHealth.healthy ? "OK" : pxpipeHealth.error || "Unhealthy"}
            </p>
          )}
          {pxpipeActionError && (
            <p className="text-sm text-warning">{pxpipeActionError}</p>
          )}
        </div>
      </Card>

      <Modal
        isOpen={showHeadroomInstallModal}
        title={headroomRunning ? "Headroom" : "Setup Headroom"}
        onClose={() => setShowHeadroomInstallModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <span
              className={headroomRunning ? "text-success" : "text-warning"}
            >
              {headroomStatusLabel}
            </span>
          </div>
          {headroomRunning && (
            <a
              href="/api/headroom/proxy/dashboard"
              target="_blank"
              rel="noreferrer"
              className="w-full rounded border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
            >
              Open Headroom Dashboard
            </a>
          )}
          {headroomDiagnostic && (
            <SetupDiagnosticCard
              diagnostic={headroomDiagnostic}
              onRetry={refreshHeadroomStatus}
            />
          )}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Proxy URL</p>
            <Input
              value={headroomUrl}
              onChange={(e) => setHeadroomUrl(e.target.value)}
              onBlur={handleHeadroomUrlBlur}
              placeholder="http://localhost:8787"
              className="font-mono text-sm"
            />
            <p className="text-xs text-text-muted">
              Use a local proxy for Start/Stop, or an external Docker sidecar
              like http://headroom:8787.
            </p>
          </div>
          {headroomManaged ? (
            <Button
              onClick={handleHeadroomStop}
              variant="ghost"
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Stopping…" : "Stop Headroom"}
            </Button>
          ) : headroomRunning ? (
            <p className="text-sm text-success">
              Headroom proxy is reachable. You can enable the token saver.
            </p>
          ) : headroomCanStart ? (
            <Button
              onClick={handleHeadroomStart}
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Starting…" : "Start Headroom"}
            </Button>
          ) : !headroomLocalUrl ? (
            <p className="text-sm text-warning">
              Start Headroom separately at the configured URL, then recheck.
            </p>
          ) : !headroomStatus.python ? (
            <p className="text-sm text-warning">
              Python ≥ 3.10 required for local managed mode. Install Python
              first, or use an external proxy URL.
            </p>
          ) : (
            <p className="text-sm text-text-muted">
              Start Headroom to create and use DurinDoor&apos;s managed environment.
            </p>
          )}
          {headroomDiagnostic ? null : (
            headroomActionError && (
              <p className="text-sm text-warning">{headroomActionError}</p>
            )
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshHeadroomStatus()}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button
              onClick={() => setShowHeadroomInstallModal(false)}
              fullWidth
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>
      </>}
    </div>
  );
}
