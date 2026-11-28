"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardFooter, CardHeader } from "@/shared/ui/components/Card.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { APP_CONFIG } from "@/shared/constants/config";
import SelectiveTransferPanel from "./SelectiveTransferPanel";
import api from "@/shared/utils/api";
import { DATA_RETENTION_PRESETS, describeRetentionRun, statusClass } from "./profileHelpers.js";

/** System & Data tab: backups, observability, data retention, shutdown, and logout. */
export default function SystemSettingsSection({
  activeTab, settings, setSettings, loading, confirmPassword, isRemoteHost,
  retentionStatus, setRetentionStatus, setShutdownOpen,
  dbLoading, dbStatus, setDbAuth, importFileRef, handleImportDatabase
}) {
  const [toolSourcesSaving, setToolSourcesSaving] = useState(false);
  const [toolSourcesError, setToolSourcesError] = useState("");
  const [observabilityError, setObservabilityError] = useState("");
  const [retentionRunning, setRetentionRunning] = useState(false);
  const [retentionCustomMode, setRetentionCustomMode] = useState(false);
  const [retentionCustomInput, setRetentionCustomInput] = useState("");

  const updateLogToolSources = async (enabled) => {
    setToolSourcesSaving(true);
    setToolSourcesError("");
    try {
      const res = await requestSettings( {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logToolSources: enabled }),
        confirmPassword
      });
      if (!res.ok) throw new Error((await res.json()).error || "Settings update failed");
      setSettings((prev) => ({ ...prev, logToolSources: enabled }));
    } catch {
      setToolSourcesError("Could not save tool source diagnostics. Try again.");
    } finally {
      setToolSourcesSaving(false);
    }
  };

  const updateObservabilityEnabled = async (enabled) => {
    setObservabilityError("");
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableObservability: enabled }),
        confirmPassword
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, enableObservability: enabled }));
      } else {
        setObservabilityError((await res.json()).error || "Failed to update observability");
      }
    } catch (err) {
      setObservabilityError("Failed to update observability");
      console.error("Failed to update enableObservability:", err);
    }
  };

  const updateProxyTimelineEnabled = async (enabled) => {
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableProxyTimeline: enabled }),
      });
      if (res.ok) setSettings((prev) => ({ ...prev, enableProxyTimeline: enabled }));
    } catch (err) {
      console.error("Failed to update enableProxyTimeline:", err);
    }
  };

  const updateDataRetention = async (patch) => {
    try {
      const res = await requestSettings({
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
      const data = await api.post("/api/data-retention", {});
      setRetentionStatus(describeRetentionRun(data));
    } catch (err) {
      console.error("Failed to run data retention:", err);
      setRetentionStatus(err?.body?.error || "Cleanup failed.");
    } finally {
      setRetentionRunning(false);
    }
  };

  const updateProxyTimelineRetention = async (value) => {
    const days = Number(value);
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyTimelineRetentionDays: days }),
      });
      if (res.ok) setSettings((prev) => ({ ...prev, proxyTimelineRetentionDays: days }));
    } catch (err) {
      console.error("Failed to update proxyTimelineRetentionDays:", err);
    }
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

  const handleLogout = async () => {
    try {
      await api.post("/api/auth/logout");
      window.location.assign((process.env.NEXT_PUBLIC_BASE_PATH || "") + "/login");
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
      <section role="tabpanel" aria-label="System and data settings" hidden={activeTab !== "system"} className="flex flex-col gap-5">
      <Card padding={false}><CardHeader icon="storage" title="Data & Backups" subtitle="Local database, transfer, and backups" /><CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 border-b border-dd-border-subtle pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[13px] font-medium text-dd-text">Database location</p><p className="break-all font-mono text-xs text-dd-muted">~/.9router/db/data.sqlite (DurinDoor data directory)</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" icon="download" onClick={() => setDbAuth({ open: true, mode: "export", password: "" })} loading={dbLoading}>Download Backup</Button><Button variant="secondary" icon="upload" onClick={() => importFileRef.current?.click()} disabled={dbLoading}>Import Backup</Button><input ref={importFileRef} tabIndex={-1} aria-label="Import database backup" type="file" accept="application/json,.json" className="sr-only" onChange={handleImportDatabase} /></div></div>
        {dbStatus.message ? <p role="status" className={`text-xs ${statusClass(dbStatus)}`}>{dbStatus.message}</p> : null}<SelectiveTransferPanel />
      </CardContent></Card>

      <Card padding={false}><CardHeader icon="monitoring" title="Observability" subtitle="Local request diagnostics and retention" /><CardContent className="flex flex-col gap-5"><Toggle label="Enable Observability" description="Record request details for inspection in logs view." checked={observabilityEnabled} onChange={updateObservabilityEnabled} disabled={loading} />{observabilityError ? <p role="alert" className="text-xs text-dd-danger">{observabilityError}</p> : null}<Toggle label="Log tool sources" description="Log tool names and source counts for authenticated requests when LOG_LEVEL=DEBUG. Tool names may disclose identifiers." checked={settings.logToolSources === true} onChange={updateLogToolSources} disabled={loading || toolSourcesSaving} />{toolSourcesError ? <p role="alert" className="text-xs text-dd-danger">{toolSourcesError}</p> : null}<Toggle label="Proxy timeline" description="Capture redacted hops in a sidecar database. Secrets stay redacted." checked={proxyTimelineEnabled} onChange={updateProxyTimelineEnabled} disabled={loading} /><Field label="Timeline retention" hint="Days to keep sidecar traces."><Select aria-label="Timeline retention" options={[{value:1,label:"1 day"},{value:3,label:"3 days"},{value:7,label:"7 days"}]} value={proxyTimelineRetentionDays} disabled={loading || !proxyTimelineEnabled} onChange={updateProxyTimelineRetention} /></Field>
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
      </section>
  );
}
