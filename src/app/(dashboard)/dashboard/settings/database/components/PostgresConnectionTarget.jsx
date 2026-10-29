"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { normalizeSslmode, SSL_MODES } from "./sslmode.js";

export default function PostgresConnectionTarget({ effective, password, onUnauthorized, onPersisted }) {
  const [draft, setDraft] = useState(() => ({ host: "", port: "5432", database: "", user: "", ...effective, sslmode: normalizeSslmode(effective?.sslmode) }));
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function testAndPersist() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/settings/database/test", {
        method: "POST",
        headers: { "content-type": "application/json", "x-9r-password": password },
        body: JSON.stringify({ ...draft, password: credential, persist: true }),
      });
      if (response.status === 401) { onUnauthorized(); return; }
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Failed to test PostgreSQL target");
      setCredential("");
      setResult({ ok: true, message: `Target saved. Connected in ${body.latencyMs ?? 0}ms (${body.serverVersion || "unknown"}). Ready for cutover without restarting.` });
      await onPersisted();
    } catch (error) {
      setResult({ ok: false, message: error.message });
    } finally { setBusy(false); }
  }

  return (
    <Card padding={false}>
      <CardHeader icon="cable" title="PostgreSQL connection" subtitle="Test and persist the cutover target before migrating SQLite data. This does not change startup configuration." />
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[["host", "Target host"], ["port", "Target port"], ["database", "Target database"], ["user", "Target user"]].map(([key, label]) => (
            <Input key={key} label={label} value={draft[key]} disabled={busy} onChange={(event) => { setDraft((previous) => ({ ...previous, [key]: event.target.value })); setResult(null); }} />
          ))}
          <Input label="Target password" type="password" autoComplete="new-password" value={credential} disabled={busy} onChange={(event) => { setCredential(event.target.value); setResult(null); }} hint="Write-only. Enter the target password each time; leave empty only for passwordless authentication." />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-dd-muted">Target SSL mode</span>
            <Select aria-label="Target SSL mode" disabled={busy} value={draft.sslmode} onChange={(value) => { setDraft((previous) => ({ ...previous, sslmode: value })); setResult(null); }} options={SSL_MODES.map((value) => ({ value, label: value }))} />
          </div>
        </div>
        <Button variant="primary" disabled={busy || !draft.host || !draft.database || !draft.user} onClick={testAndPersist}>{busy ? "Testing..." : "Test connection and save target"}</Button>
        {result ? <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-dd-success" : "text-dd-danger"}`}>{result.message}</p> : null}
      </CardContent>
    </Card>
  );
}
