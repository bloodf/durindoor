"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState, useEffect, useRef, useCallback } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Tabs from "@/shared/ui/components/Tabs.jsx";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import { useTheme } from "@/shared/hooks/useTheme";
import { usePasswordPrompt } from "@/shared/hooks/usePasswordPrompt";
import ReauthDialog from "@/shared/components/ReauthDialog.jsx";
import { isBrowser, isObject } from "../../../../shared/utils/typeChecks.js";
import api from "@/shared/utils/api";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import { SETTINGS_TABS, describeRetentionRun, getLocaleFromCookie } from "./profileHelpers.js";
import { useDatabaseBackup } from "./useDatabaseBackup.js";
import GeneralSettingsSection from "./GeneralSettingsSection.jsx";
import SecuritySettingsSection from "./SecuritySettingsSection.jsx";
import RoutingSettingsSection from "./RoutingSettingsSection.jsx";
import NetworkSettingsSection from "./NetworkSettingsSection.jsx";
import SystemSettingsSection from "./SystemSettingsSection.jsx";

export default function ProfilePage() {
  const uiV5 = useUiV5();
  const { theme, setTheme } = useTheme();
  const [locale, setLocale] = useState("en");
  const [activeTab, setActiveTab] = useState("general");
  const [langOpen, setLangOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [settings, setSettings] = useState({ fallbackStrategy: "fill-first" });
  // Keep OIDC disclosure unavailable until saved settings settle its layout and draft.
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const settingsRequest = useRef(0);
  const { confirmPassword, prompt: reauth } = usePasswordPrompt();

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

  const [authAvailability, setAuthAvailability] = useState({ passwordAvailable: true, oidcAvailable: false });

  useEffect(() => {
    const controller = new AbortController();
    api.get("/api/auth/status", { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && data) setAuthAvailability(data);
    }).catch(() => {});
    return () => controller.abort();
  }, [settings.authMode, settings.oidcConfigured]);

  const loadSettings = useCallback(() => {
    const request = ++settingsRequest.current;
    setLoading(true);
    setSettingsError("");
    return requestSettings().
    then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data || !isObject(data) || Array.isArray(data)) throw new Error(data?.error || "Settings could not be loaded.");
      return data;
    }).
    then((data) => {
      if (request !== settingsRequest.current) return;
      setSettings(data);
      setSettingsReady(true);
      setLoading(false);
    }).
    catch((err) => {
      if (request !== settingsRequest.current) return;
      setSettingsError(err.message || "Settings could not be loaded.");
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadSettings(); return () => { settingsRequest.current++; }; }, [loadSettings]);

  const [retentionStatus, setRetentionStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.get("/api/data-retention", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted || !data?.lastRun) return;
        setRetentionStatus(describeRetentionRun(data.lastRun));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const { dbLoading, dbStatus, dbAuth, setDbAuth, importFileRef, handleImportDatabase, handleDbAuthConfirm } = useDatabaseBackup(setSettings);

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await api.post("/api/version/shutdown");
    } catch {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  if (!settingsReady && uiV5) return <main aria-label="Profile settings" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
    <h1 className="text-xl font-semibold tracking-tight text-dd-text">Settings</h1>
    <Card padding={false}><CardContent>{loading ? <p role="status" className="text-[13px] text-dd-muted">Loading settings…</p> : <div role="alert" className="flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-dd-danger">{settingsError}</p><Button icon="refresh" variant="secondary" onClick={loadSettings}>Retry settings</Button></div>}</CardContent></Card>
  </main>;

  if (!settingsReady) return <main aria-label="Profile settings" className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
    <h1 className="text-2xl font-semibold">Settings</h1>
    {loading ? <p role="status">Loading settings…</p> : <div role="alert" className="space-y-3"><p>{settingsError}</p><Button icon="refresh" onClick={loadSettings}>Retry settings</Button></div>}
  </main>;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6" aria-label="Profile settings">
      <header className="flex flex-col gap-1 border-b border-dd-border-subtle pb-5">
        <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"><span className="material-symbols-outlined" aria-hidden="true">settings</span></span><div><h1 className="text-xl font-semibold tracking-tight text-dd-text">Settings</h1><p className="text-[13px] text-dd-muted">Local dashboard, routing, and service preferences</p></div></div>
      </header>
      <div className="[&>[role=tablist]]:flex-wrap" aria-label="Settings categories">
        <Tabs tabs={SETTINGS_TABS} value={activeTab} onChange={setActiveTab} aria-label="Settings categories" />
      </div>

      <GeneralSettingsSection activeTab={activeTab} settings={settings} setSettings={setSettings} loading={loading} theme={theme} setTheme={setTheme} locale={locale} setLangOpen={setLangOpen} />

      <SecuritySettingsSection activeTab={activeTab} settings={settings} setSettings={setSettings} loading={loading} confirmPassword={confirmPassword} authAvailability={authAvailability} />

      <RoutingSettingsSection activeTab={activeTab} settings={settings} setSettings={setSettings} loading={loading} />

      <NetworkSettingsSection activeTab={activeTab} settings={settings} setSettings={setSettings} loading={loading} confirmPassword={confirmPassword} />

      <SystemSettingsSection
        activeTab={activeTab} settings={settings} setSettings={setSettings} loading={loading} confirmPassword={confirmPassword} isRemoteHost={isRemoteHost}
        retentionStatus={retentionStatus} setRetentionStatus={setRetentionStatus} setShutdownOpen={setShutdownOpen}
        dbLoading={dbLoading} dbStatus={dbStatus} setDbAuth={setDbAuth} importFileRef={importFileRef} handleImportDatabase={handleImportDatabase}
      />
      <LanguageSwitcher hideTrigger isOpen={langOpen} onClose={(next) => { setLangOpen(false); setLocale(next); }} />
      <ConfirmDialog open={shutdownOpen} pending={isShuttingDown} onCancel={() => setShutdownOpen(false)} onConfirm={handleShutdown} title="Close Proxy" message="Are you sure you want to close the proxy server?" confirmLabel="Close" cancelLabel="Cancel" tone="danger" />
      <Modal open={dbAuth.open} onClose={() => setDbAuth({ open: false, mode: "", password: "" })} title="Confirm Password" size="sm" pending={dbLoading} footer={<><Button variant="secondary" onClick={() => setDbAuth({ open: false, mode: "", password: "" })} disabled={dbLoading}>Cancel</Button><Button variant="primary" onClick={handleDbAuthConfirm} loading={dbLoading} disabled={!dbAuth.password}>Confirm</Button></>}><div className="flex flex-col gap-3"><p className="text-[13px] text-dd-muted">Enter your current password to {dbAuth.mode === "export" ? "export" : "import"} the database.</p><Input type="password" value={dbAuth.password} onChange={(e) => setDbAuth((state) => ({ ...state, password: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && dbAuth.password) handleDbAuthConfirm(); }} placeholder="Current password" autoFocus /></div></Modal>
      <ReauthDialog prompt={reauth} />
    </main>
  );
}
