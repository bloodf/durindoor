"use client";

/**
 * MCP Gateway — Instances.
 *
 * Registering upstream servers and minting the keys that reach them are
 * different jobs on different schedules: instances are configured once and
 * tested repeatedly, while keys are minted per harness and revoked
 * independently. They were one page with two stacked cards, so every key
 * action reloaded the instance list and vice versa. Keys now live at
 * `/dashboard/mcp-gateway/keys`.
 *
 * This page owns only instances. It does not fetch keys at all.
 */

import { useState } from "react";
import Link from "next/link";
import Button from "@/shared/ui/components/Button.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { isString } from "@/shared/utils/typeChecks.js";
import { InstanceEditModal, InstancesPanel } from "./McpGatewayComponents.jsx";
import { emptyInstance, nowMs, parseMaybeJson, stringifyMaybe, useGatewayCollection } from "./shared.js";

export default function McpGatewayPage({ openPopup = (url, target) => window.open(url, target) }) {
  const { items: instances, loading, reload, notify } = useGatewayCollection("/api/mcp-gateway/instances", "instances");
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [testResults, setTestResults] = useState({});

  async function saveInstance(form) {
    const isNew = !form.id;
    const res = await fetch(isNew ? "/api/mcp-gateway/instances" : `/api/mcp-gateway/instances/${form.id}`, {
      method: isNew ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, args: parseMaybeJson(form.args, []), env: parseMaybeJson(form.env, {}), headers: parseMaybeJson(form.headers, {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { notify({ type: "error", message: body.error ?? `save failed (${res.status})` }); return false; }
    notify({ type: "success", message: isNew ? "Instance created" : "Instance updated" }); return true;
  }
  async function toggleInstanceEnabled(id, enabled) {
    const res = await fetch(`/api/mcp-gateway/instances/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); notify({ type: "error", message: body.error ?? `toggle failed (${res.status})` }); return; }
    await reload();
  }
  async function deleteInstance(id) {
    const res = await fetch(`/api/mcp-gateway/instances/${id}`, { method: "DELETE" });
    if (!res.ok) { const body = await res.json().catch(() => ({})); notify({ type: "error", message: body.error ?? "delete failed" }); return; }
    notify({ type: "success", message: "Instance deleted" }); setConfirmDelete(null); await reload();
  }
  async function connectInstance(id) {
    try {
      const authRes = await fetch(`/api/mcp-gateway/oauth/${id}/authorize`);
      const authBody = await authRes.json().catch(() => ({}));
      if (!authRes.ok || !authBody.url) { notify({ type: "error", message: authBody.error ?? `authorize failed (${authRes.status})` }); return; }
      if (!openPopup(authBody.url, "_blank")) { notify({ type: "error", message: "popup blocked — allow popups for this site" }); return; }
      const startedAt = nowMs();
      const tick = async () => {
        if (nowMs() - startedAt > 300000) { notify({ type: "warning", message: "OAuth flow timed out — check the popup tab" }); return; }
        try {
          const response = await fetch(`/api/mcp-gateway/oauth/${id}/status?state=${encodeURIComponent(authBody.state ?? "")}`);
          const body = await response.json();
          if (body.status === "complete") { notify({ type: "success", message: "Connected" }); await reload(); return; }
          if (body.status === "error") { notify({ type: "error", message: body.error ?? "OAuth failed" }); await reload(); return; }
        } catch { /* retain polling behavior after transient errors */ }
        setTimeout(tick, 1500);
      };
      setTimeout(tick, 1500);
    } catch (error) { notify({ type: "error", message: error instanceof Error ? error.message : "OAuth error" }); }
  }
  async function testInstance(id) {
    setTestResults((current) => ({ ...current, [id]: { loading: true } }));
    try {
      const res = await fetch(`/api/mcp-gateway/instances/${id}/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = isString(body?.error) && body.error ? body.error : `test failed (HTTP ${res.status})`;
        setTestResults((current) => ({ ...current, [id]: { ok: false, error: message, status: res.status } })); return;
      }
      setTestResults((current) => ({ ...current, [id]: body }));
    } catch (error) { setTestResults((current) => ({ ...current, [id]: { ok: false, error: error instanceof Error ? error.message : "test failed" } })); }
  }

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 text-[13px]">
    <PageHeader icon="hub" title="MCP Gateway" subtitle={<span>Register upstream MCP servers. Tools appear as <code className="rounded-dd bg-dd-surface-2 px-1 font-mono text-xs text-dd-text">&lt;slug&gt;__&lt;toolName&gt;</code>.</span>} actions={<><Link href="/dashboard/mcp-gateway/keys" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined text-base">vpn_key</span>Gateway keys</Link><Button variant="primary" icon="add" onClick={() => setEditing(emptyInstance())}>New instance</Button></>} />
    <InstancesPanel instances={instances} loading={loading} testResults={testResults} onCreate={() => setEditing(emptyInstance())} onToggle={toggleInstanceEnabled} onTest={testInstance} onConnect={connectInstance} onEdit={(instance) => setEditing({ ...instance, args: stringifyMaybe(instance.args), env: stringifyMaybe(instance.env), headers: stringifyMaybe(instance.headers) })} onDelete={(id) => setConfirmDelete({ kind: "instance", id })} />
    {editing ? <InstanceEditModal initial={editing} onClose={() => setEditing(null)} onSave={async (form) => { if (await saveInstance(form)) { setEditing(null); await reload(); } }} /> : null}
    <ConfirmDialog open={confirmDelete?.kind === "instance"} title="Delete instance?" message="All grants to this instance will also be removed." confirmLabel="Delete instance" onConfirm={() => deleteInstance(confirmDelete.id)} onCancel={() => setConfirmDelete(null)} />
  </main>;
}
