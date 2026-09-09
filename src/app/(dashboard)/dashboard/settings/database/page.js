"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import { CapabilityMatrix } from "./components/CapabilityMatrix.jsx";

const REFRESH_MS = 5000;

export default function DatabaseSettingsPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testUrl, setTestUrl] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [testBusy, setTestBusy] = useState(false);
  const [cutoverBusy, setCutoverBusy] = useState(false);
  const [showCutoverConfirm, setShowCutoverConfirm] = useState(false);
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/database/engine", {
        headers: { "x-9r-password": window.prompt("Dashboard password") || "" },
      });
      if (!res.ok) {
        setError(`Failed to load (${res.status})`);
        return;
      }
      setStatus(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  async function handleTest() {
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/database/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-9r-password": window.prompt("Dashboard password") || "",
        },
        body: JSON.stringify({ url: testUrl, persist: true }),
      });
      setTestResult(await res.json());
    } finally {
      setTestBusy(false);
    }
  }

  async function handleCutover() {
    setCutoverBusy(true);
    try {
      const res = await fetch("/api/settings/database/cutover", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-9r-password": window.prompt("Dashboard password") || "",
        },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error || `Cutover failed (${res.status})`);
      } else {
        await refresh();
      }
    } finally {
      setCutoverBusy(false);
      setShowCutoverConfirm(false);
    }
  }

  async function handleRollback() {
    try {
      const res = await fetch("/api/settings/database/rollback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-9r-password": window.prompt("Dashboard password") || "",
        },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error || `Rollback failed (${res.status})`);
      } else {
        await refresh();
      }
    } finally {
      setShowRollbackConfirm(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <PageHeader icon="database" title="Database Settings" subtitle="Loading..." />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6" aria-label="Database settings">
      <PageHeader
        icon="database"
        title="Database Settings"
        subtitle="Choose between the local SQLite engine and an opt-in PostgreSQL cluster."
        actions={
          <span className="text-xs text-dd-muted">
            Last refresh: {new Date().toLocaleTimeString()}
          </span>
        }
      />

      {error ? (
        <Card padding={false}>
          <CardContent>
            <p className="text-[13px] text-red-500">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      <section aria-label="Engine status" className="grid gap-4 md:grid-cols-3">
        <StatCard label="Engine" value={status?.activeEngine || "sqlite"} hint="Active engine" />
        <StatCard label="Cluster version" value={String(status?.databasePgVersion || 18)} hint="Operator cap" />
        <StatCard
          label="Last cutover"
          value={status?.databaseCutoverAt ? new Date(status.databaseCutoverAt).toLocaleString() : "never"}
          hint={status?.databaseCutoverSchemaVersion ? `schema v${status.databaseCutoverSchemaVersion}` : "no cutover yet"}
        />
      </section>

      {status?.databaseEngineError ? (
        <Card padding={false}>
          <CardHeader icon="error" title="Engine error" subtitle="The runtime is on SQLite because the PG boot failed" />
          <CardContent>
            <p className="font-mono text-[13px] text-dd-text">{status.databaseEngineError}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card padding={false}>
        <CardHeader
          icon="cable"
          title="PostgreSQL connection"
          subtitle="Test the cluster before flipping the runtime"
        />
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="text-[13px] text-dd-muted">Connection URL (password included)</span>
              <input
                type="text"
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                placeholder="postgres://user:password@host:5432/db"
                className="mt-1 w-full rounded-md border border-dd-border bg-dd-surface px-3 py-2 font-mono text-[13px] text-dd-text"
              />
            </label>
            <Button variant="primary" icon="wifi_tethering" onClick={handleTest} disabled={testBusy || !testUrl}>
              {testBusy ? "Testing..." : "Test connection"}
            </Button>
          </div>
          {testResult ? (
            <p className={`mt-2 text-[13px] ${testResult.ok ? "text-emerald-500" : "text-red-500"}`}>
              {testResult.ok
                ? `Connected in ${testResult.latencyMs}ms (${testResult.serverVersion || "unknown"})`
                : `Failed: ${testResult.error}`}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <CapabilityMatrix features={status?.databasePgFeatures || {}} effective={status?.effectiveCapabilities || {}} />

      <Card padding={false}>
        <CardHeader icon="swap_horiz" title="Switch engine" subtitle="Cutover is one-way: it is reversible from the rollback button after a successful cut." />
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            icon="play_arrow"
            onClick={() => setShowCutoverConfirm(true)}
            disabled={cutoverBusy || status?.activeEngine === "postgres"}
          >
            Cut over to Postgres
          </Button>
          <Button
            variant="ghost"
            icon="undo"
            onClick={() => setShowRollbackConfirm(true)}
            disabled={status?.activeEngine !== "postgres" || !status?.snapshots?.length}
          >
            Switch back to SQLite
          </Button>
        </CardContent>
      </Card>

      {showCutoverConfirm ? (
        <ConfirmDialog
          open
          title="Cut over to Postgres"
          body="This will mirror every SQLite table to the target cluster, flip the runtime to PG, and persist the change. The process takes a few seconds to a few minutes depending on DB size."
          confirmLabel="Cut over"
          confirmVariant="primary"
          onConfirm={handleCutover}
          onCancel={() => setShowCutoverConfirm(false)}
        />
      ) : null}

      {showRollbackConfirm ? (
        <ConfirmDialog
          open
          title="Switch back to SQLite"
          body="The most recent cutover snapshot will be restored and the runtime will boot from SQLite. The PG cluster is left untouched."
          confirmLabel="Rollback"
          confirmVariant="ghost"
          onConfirm={handleRollback}
          onCancel={() => setShowRollbackConfirm(false)}
        />
      ) : null}
    </main>
  );
}
