"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
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
  sourceLabel } from
"@/shared/utils/setupDiagnosticView";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS } from
"../endpoint/endpointConstants";
import { fetchPxpipeStatus, getPxpipeStatusView } from "../pxpipe/pxpipeStatus.js";
import { isNumber } from "../../../../shared/utils/typeChecks.js";

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
    loading: true
  });
  const [pxpipeHealth, setPxpipeHealth] = useState(null);
  const [pxpipeActionLoading, setPxpipeActionLoading] = useState(false);
  const [pxpipeActionError, setPxpipeActionError] = useState("");
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomTimeoutMs, setHeadroomTimeoutMs] = useState("15000");
  const [headroomTimeoutInputValue, setHeadroomTimeoutInputValue] = useState("15000");
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true
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
    loading: false
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
  const visibleCavemanLevels = isWenyanLocale ?
  CAVEMAN_LEVELS :
  CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

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
        body: JSON.stringify(patch)
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
        body: JSON.stringify({ rtkEnabled: value })
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

  /** Persist a validated Headroom request timeout, or restore the saved value. */
  const handleHeadroomTimeoutBlur = () => {
    if (headroomTimeoutInputValue === "") {
      setHeadroomTimeoutInputValue(headroomTimeoutMs);
      return;
    }
    const n = Number(headroomTimeoutInputValue);
    if (Number.isSafeInteger(n) && n >= 1000 && n <= 120000) {
      setHeadroomTimeoutMs(headroomTimeoutInputValue);
      patchSetting({ headroomTimeoutMs: n });
    } else {
      setHeadroomTimeoutInputValue(headroomTimeoutMs);
    }
  };

  const refreshHeadroomStatus = useCallback(async () => {
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" }
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
        loading: false
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
        body: JSON.stringify({ extras: ["code", "ml"] })
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
    if (isNumber(data.minChars)) {
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

      /* non-fatal: quick-add suggestions are best-effort */}
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
          setHeadroomTimeoutMs(String(data.headroomTimeoutMs ?? 15000));
          setHeadroomTimeoutInputValue(String(data.headroomTimeoutMs ?? 15000));
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
  const headroomStatusLabel = headroomStatus.loading ?
  "Checking…" :
  headroomRunning ?
  "Running" :
  headroomStatus.localUrl !== false && !headroomStatus.installed ?
  "Not installed" :
  headroomStatus.localUrl !== false ?
  "Stopped" :
  "External";
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
  headroomLocalUrl && !!headroomStatus.managedPid;
  const pxpipeStatusView = getPxpipeStatusView(pxpipeStatus, pxpipeHealth);
  const pxpipeStatusLabel = pxpipeStatusView.label;

  const headroomTone = headroomRunning ? "success" : headroomStatus.loading ? "neutral" : "warning";
  const pxpipeTone = pxpipeHealth?.healthy || pxpipeStatus.running ? "success" : pxpipeStatusView.dependencyMissing || pxpipeStatusView.error ? "warning" : "neutral";
  if (view === "overview") return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6"><TokenSaverOverview /><PxpipeClient embedded /></div>;
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6"><PageHeader icon="savings" title="Token Saver settings" subtitle="Tune context and output compression without changing provider behavior." /><Card padding={false} id="rtk"><div className="border-b border-dd-border-subtle px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold text-dd-text"><span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-accent">bolt</span>Text and context compression</h2></div><div className="space-y-4 p-5"><Toggle label={<span>Compress tool output <a href="https://github.com/rtk-ai/rtk" target="_blank" rel="noreferrer" className="text-dd-accent underline underline-offset-2">(RTK)</a></span>} description="git/grep/ls/tree/logs → 60–90% fewer input tokens" checked={rtkEnabled} onChange={handleRtkEnabled} aria-label="Enable RTK" /><div className="border-t border-dd-border-subtle" /><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[13px] font-medium text-dd-text">Compress context <a href="https://github.com/chopratejas/headroom" target="_blank" rel="noreferrer" className="text-dd-accent underline underline-offset-2">(Headroom)</a></p><Badge tone={headroomTone} size="sm">{headroomStatusLabel}</Badge><a href="/dashboard/headroom" className="text-xs text-dd-accent underline underline-offset-2">Open full page</a><button type="button" onClick={() => setShowHeadroomInstallModal(true)} className="min-h-11 rounded-dd px-2 text-xs font-medium text-dd-accent outline-none hover:bg-dd-accent-soft focus-visible:shadow-dd-focus">{headroomRunning ? "Manage" : "Setup"}</button></div><p className="mt-1 text-xs text-dd-muted">Compress prompts via /v1/compress before routing to model.</p></div><Toggle checked={headroomEnabled} onChange={handleHeadroomEnabled} aria-label="Enable Headroom" /></div>{headroomDiagnostic ? <SetupDiagnosticCard diagnostic={headroomDiagnostic} onRetry={refreshHeadroomStatus} /> : null}{headroomStatus.installed ? <div className="space-y-3 border-s-2 border-dd-border ps-4"><p className="text-xs text-dd-muted">Source: {sourceLabel(headroomStatus.source || headroomExtras.source || null)}{headroomExtras.version ? ` · v${headroomExtras.version}` : ""}</p><p className="text-xs text-dd-muted">{formatExtrasSummary(headroomExtras.extras)}</p>{shouldShowExternalInstallNote(headroomExtras) ? <p className="text-xs text-dd-muted">{externalInstallNote(headroomExtras.externalInstall)}{headroomExtras.externalInstall?.uninstallCommand ? <><code className="ms-1 break-all rounded-dd bg-dd-surface-2 px-1 py-0.5 text-dd-text">{headroomExtras.externalInstall.uninstallCommand}</code><Button size="sm" variant="ghost" className="ms-2" onClick={() => copy(headroomExtras.externalInstall.uninstallCommand, "external-install-uninstall")}>{copied === "external-install-uninstall" ? "Copied" : "Copy"}</Button></> : <span className="ms-1">Remove it with installer tool manager.</span>}</p> : null}<div className="flex flex-wrap items-center gap-2"><Button onClick={handleInstallExtras} loading={extrasActionLoading} size="sm">{installActionLabel({ installed: headroomStatus.installed, extras: headroomExtras.extras })}</Button><span className="text-xs text-dd-muted">ML downloads torch; may take several minutes.</span></div>{extrasDiagnostic ? <SetupDiagnosticCard diagnostic={extrasDiagnostic} onRetry={refreshHeadroomStatus} /> : extrasActionError ? <p role="alert" className="text-xs text-dd-danger">{extrasActionError}</p> : null}</div> : null}<div className="border-t border-dd-border-subtle" /><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[13px] font-medium text-dd-text">Compress LLM output <a href="https://github.com/JuliusBrussee/caveman" target="_blank" rel="noreferrer" className="text-dd-accent underline underline-offset-2">(Caveman)</a></p><p className="mt-1 text-xs text-dd-muted">Terse-style system prompt reduces output tokens.</p></div><div className="flex flex-wrap items-center gap-2">{cavemanEnabled ? <div className="flex flex-col gap-1"><SegmentedControl aria-label="Caveman level" options={visibleCavemanLevels.map((level) => ({ value: level.id, label: level.label }))} value={cavemanLevel} onChange={handleCavemanLevel} size="sm" /><p className="text-xs text-dd-accent">{CAVEMAN_LEVELS.find((level) => level.id === cavemanLevel)?.desc}</p></div> : null}<Toggle checked={cavemanEnabled} onChange={handleCavemanEnabled} aria-label="Enable Caveman" /></div></div><div className="border-t border-dd-border-subtle" /><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[13px] font-medium text-dd-text">Lazy senior dev <a href="https://github.com/DietrichGebert/ponytail" target="_blank" rel="noreferrer" className="text-dd-accent underline underline-offset-2">(Ponytail)</a></p><p className="mt-1 text-xs text-dd-muted">Bias model toward minimal code: YAGNI, stdlib, deletion.</p></div><div className="flex flex-wrap items-center gap-2">{ponytailEnabled ? <div className="flex flex-col gap-1"><SegmentedControl aria-label="Ponytail level" options={PONYTAIL_LEVELS.map((level) => ({ value: level.id, label: level.label }))} value={ponytailLevel} onChange={handlePonytailLevel} size="sm" /><p className="text-xs text-dd-accent">{PONYTAIL_LEVELS.find((level) => level.id === ponytailLevel)?.desc}</p></div> : null}<Toggle checked={ponytailEnabled} onChange={handlePonytailEnabled} aria-label="Enable Ponytail" /></div></div></div></Card><Card padding={false} id="pxpipe"><div className="border-b border-dd-border-subtle px-5 py-4"><h2 className="flex items-center gap-2 text-sm font-semibold text-dd-text"><span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-accent">image</span>PXPIPE</h2></div><div className="space-y-4 p-5"><Toggle label="Compress bulky Claude context into images" description="Render large text context as dense PNGs for vision-capable models. Fail-open." checked={pxpipeEnabled} disabled={pxpipeStatusView.dependencyMissing} onChange={handlePxpipeEnabled} aria-label="Enable PXPIPE" /><div className="flex flex-wrap items-center justify-between gap-3 border-t border-dd-border-subtle pt-4"><StatusDot tone={pxpipeTone} label={`${pxpipeStatusLabel}${pxpipeStatus.version ? ` · v${pxpipeStatus.version}` : ""}`} /><div className="flex flex-wrap items-center gap-2">{pxpipeStatusView.error ? <p role="alert" className="max-w-xs text-xs text-dd-warning">PXPIPE status unavailable: {pxpipeStatusView.error}</p> : pxpipeStatusView.dependencyMissing ? <p role="alert" className="max-w-xs text-xs text-dd-warning">PXPIPE dependency missing. Reinstall application to restore it.</p> : pxpipeStatus.running ? <Button variant="secondary" size="sm" loading={pxpipeActionLoading} onClick={() => pxpipeAction("stop")}>Stop</Button> : <Button size="sm" loading={pxpipeActionLoading} onClick={() => pxpipeAction("start")}>Start</Button>}{pxpipeStatus.installed ? <Button variant="secondary" size="sm" disabled={pxpipeActionLoading} onClick={() => pxpipeAction("restart")}>Restart</Button> : null}<Button variant="secondary" size="sm" icon="refresh" loading={pxpipeStatus.loading} onClick={() => { refreshPxpipeStatus(); runPxpipeHealth(); }}>Recheck</Button></div></div><div className="grid gap-4 sm:grid-cols-2"><Input label="Minimum chars" type="number" min="1" step="1" value={pxpipeInputValue} onChange={(event) => handlePxpipeMinChars(event.target.value)} onBlur={handlePxpipeMinCharsBlur} error={pxpipeMinCharsError} /><Input label="Timeout (ms)" type="number" min="1000" max="120000" step="1000" value={pxpipeTimeoutInputValue} onChange={(event) => { setPxpipeTimeoutInputValue(event.target.value); setPxpipeTimeoutError(""); }} onBlur={handlePxpipeTimeoutBlur} error={pxpipeTimeoutError} /></div><Input label="Allowed models" hint="Comma-separated model IDs. Empty leaves built-in safe default." value={pxpipeAllowedModelsInputValue} onChange={(event) => handlePxpipeAllowedModelsChange(event.target.value)} onBlur={handlePxpipeAllowedModelsBlur} placeholder="claude-fable-5, blackboxai/anthropic/claude-fable-5" />{pxpipeAllowedModels.length ? <div className="flex flex-wrap gap-2">{pxpipeAllowedModels.map((model) => <Chip key={model} label={model} size="sm" onRemove={() => removePxpipeAllowedModel(model)} />)}</div> : null}{pxpipeBlockedModels.filter((model) => !pxpipeAllowedModels.includes(model)).length ? <div className="space-y-2"><p className="text-xs text-dd-muted">Recently blocked. Select to allow:</p><div className="flex flex-wrap gap-2">{pxpipeBlockedModels.filter((model) => !pxpipeAllowedModels.includes(model)).map((model) => <Chip key={model} icon="add" label={model} size="sm" onClick={() => addPxpipeAllowedModel(model)} />)}</div></div> : null}{pxpipeHealth ? <Badge tone={pxpipeHealth.healthy ? "success" : "warning"}>Health: {pxpipeHealth.healthy ? "OK" : pxpipeHealth.error || "Unhealthy"}</Badge> : null}{pxpipeActionError ? <p role="alert" className="text-xs text-dd-danger">{pxpipeActionError}</p> : null}</div></Card><Modal open={showHeadroomInstallModal} title={headroomRunning ? "Headroom" : "Setup Headroom"} onClose={() => setShowHeadroomInstallModal(false)} footer={<><Button variant="secondary" className="flex-1" onClick={refreshHeadroomStatus}>Recheck</Button><Button className="flex-1" onClick={() => setShowHeadroomInstallModal(false)}>Done</Button></>}><div className="space-y-4"><div className="flex items-center justify-between"><span className="text-[13px] text-dd-muted">Status</span><Badge tone={headroomTone}>{headroomStatusLabel}</Badge></div>{headroomRunning ? <a href="/api/headroom/proxy/dashboard" target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-dd border border-dd-border bg-dd-surface-2 px-3 text-[13px] font-medium text-dd-text outline-none hover:bg-dd-surface-3 focus-visible:shadow-dd-focus">Open Headroom Dashboard</a> : null}{headroomDiagnostic ? <SetupDiagnosticCard diagnostic={headroomDiagnostic} onRetry={refreshHeadroomStatus} /> : null}<Input label="Proxy URL" value={headroomUrl} onChange={(event) => setHeadroomUrl(event.target.value)} onBlur={handleHeadroomUrlBlur} placeholder="http://localhost:8787" hint="Use local proxy for Start/Stop or external Docker sidecar." /><Input label="Timeout (ms)" type="number" min="1000" max="120000" step="1000" value={headroomTimeoutInputValue} onChange={(event) => setHeadroomTimeoutInputValue(event.target.value)} onBlur={handleHeadroomTimeoutBlur} hint="Request timeout. Defaults to 15000 ms." />{headroomManaged ? <Button variant="secondary" className="w-full" loading={headroomActionLoading} onClick={handleHeadroomStop}>Stop Headroom</Button> : headroomRunning ? <p className="text-[13px] text-dd-success">Headroom proxy is reachable. Enable token saver when ready.</p> : headroomCanStart ? <Button className="w-full" loading={headroomActionLoading} onClick={handleHeadroomStart}>Start Headroom</Button> : !headroomLocalUrl ? <p className="text-[13px] text-dd-warning">Start Headroom at configured URL, then recheck.</p> : !headroomStatus.python ? <p className="text-[13px] text-dd-warning">Python ≥ 3.10 required for managed local mode.</p> : <p className="text-[13px] text-dd-muted">Start Headroom to create managed environment.</p>}{!headroomDiagnostic && headroomActionError ? <p role="alert" className="text-xs text-dd-danger">{headroomActionError}</p> : null}</div></Modal></div>;

}