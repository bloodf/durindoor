"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";

const sourceLabels = { file: "from managed file", process: "from environment" };
const fields = [["host", "Host"], ["port", "Port"], ["database", "Database"], ["user", "User"]];

export default function StartupConfiguration({ startupEnv, password, onUnauthorized, onSaved }) {
  const [draft, setDraft] = useState(() => ({ engine: "sqlite", host: "", port: "5432", database: "", user: "", sslmode: "require", ...startupEnv?.effective }));
  const [credential, setCredential] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const update = (key, value) => { setDraft((previous) => ({ ...previous, [key]: value })); setResult(null); };

  async function submit(action) {
    setBusy(true);
    setResult(null);
    try {
      const options = {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { "content-type": "application/json", "x-9r-password": password },
      };
      if (action !== "remove") {
        const payload = { ...draft };
        if (passwordChanged) payload.password = credential;
        options.body = JSON.stringify(payload);
      }
      const response = await fetch(`/api/settings/database/startup-env${action === "test" ? "?test=1" : ""}`, options);
      if (response.status === 401) { onUnauthorized(); return; }
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Startup configuration request failed");
      setResult({ ok: true, message: action === "test" ? `Connection successful (${body.latencyMs ?? 0}ms)` : action === "remove" ? "Managed override removed" : "Startup configuration saved" });
      if (body.restartRequired) {
        setRestartRequired(true);
        setCredential("");
        setPasswordChanged(false);
        if (body.startupEnv?.effective) setDraft((previous) => ({ ...previous, ...body.startupEnv.effective }));
        onSaved(body.startupEnv);
      }
    } catch (error) {
      setResult({ ok: false, message: error.message });
    } finally { setBusy(false); }
  }

  return (
    <Card padding={false}>
      <CardHeader icon="settings" title="Startup configuration" subtitle="Managed startup settings do not migrate data or change the running engine." />
      <CardContent className="flex flex-col gap-4">
        {restartRequired ? <p role="status" className="rounded-dd border border-dd-border p-3 text-sm text-dd-warning">Restart DurinDoor to apply startup changes</p> : null}
        <fieldset disabled={busy} className="flex flex-wrap gap-4">
          <legend className="text-sm text-dd-muted">Engine</legend>
          {["sqlite", "postgres"].map((engine) => (
            <label key={engine} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-dd-text">
              <input type="radio" name="startup-engine" value={engine} checked={draft.engine === engine} onChange={() => update("engine", engine)} />
              {engine === "sqlite" ? "SQLite" : "PostgreSQL"}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          {[["DURINDOOR_DATABASE_ENGINE", "Engine"], ["DURINDOOR_PG_URL", "Connection"], ["DURINDOOR_PG_SSLMODE", "SSL mode"]].map(([key, label]) => (
            <span key={key} className="flex items-center gap-2 text-sm text-dd-muted">{label}<Badge>{sourceLabels[startupEnv?.keys?.[key]?.source] || "not set"}</Badge></span>
          ))}
        </div>
        {draft.engine === "postgres" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(([key, label]) => <Input key={key} label={label} value={draft[key]} disabled={busy} onChange={(event) => update(key, event.target.value)} {...(key === "port" ? { inputMode: "numeric" } : {})} />)}
            <Input label="Password" type="password" autoComplete="new-password" placeholder="unchanged" value={credential} disabled={busy} onChange={(event) => { setCredential(event.target.value); setPasswordChanged(true); setResult(null); }} hint="Write-only. Leave untouched to keep the existing password." />
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-dd-muted">SSL mode</span>
              <Select aria-label="SSL mode" value={draft.sslmode} disabled={busy} onChange={(value) => update("sslmode", value)} options={["disable", "require", "verify-full"].map((value) => ({ value, label: value }))} />
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy || draft.engine !== "postgres"} onClick={() => submit("test")}>Test</Button>
          <Button variant="primary" disabled={busy} onClick={() => submit("save")}>Save</Button>
          <Button variant="ghost" disabled={busy || !startupEnv?.exists} onClick={() => submit("remove")}>Remove override</Button>
        </div>
        {result ? <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-dd-success" : "text-dd-danger"}`}>{result.message}</p> : null}
      </CardContent>
    </Card>
  );
}
