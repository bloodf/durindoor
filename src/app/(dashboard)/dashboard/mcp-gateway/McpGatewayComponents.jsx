"use client";

/**
 * Presentational pieces shared by the MCP Gateway instances and keys pages.
 *
 * These moved out of the combined page unchanged when it was split: both pages
 * render rows and dialogs from the same vocabulary, and GrantsModal in
 * particular spans the split because a key's grants name instances.
 */

import { useEffect, useId, useState } from "react";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";
import { emptyInstance } from "./shared.js";

const KIND_OPTIONS = [
  { value: "http", label: "HTTP" },
  { value: "sse", label: "SSE" },
  { value: "npx", label: "npx" },
  { value: "python", label: "Python" },
  { value: "docker", label: "Docker" },
  { value: "command", label: "Command" },
];
const TRANSPORT_OPTIONS = [
  { value: "http", label: "http" },
  { value: "sse", label: "sse" },
  { value: "stdio", label: "stdio" },
];

export function StatusBadge({ instance }) {
  if (!instance.enabled) return <Badge size="sm" tone="neutral" icon="pause">disabled</Badge>;
  if (!instance.oauth) return <Badge size="sm" tone="success" icon="check_circle">enabled</Badge>;
  if (instance.oauthStatus === "connected") return <Badge size="sm" tone="success" icon="check_circle">connected</Badge>;
  return <Badge size="sm" tone="warning" icon="login">needs login</Badge>;
}

export function NewKeyDialog({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const formId = useId();
  function submit(event) {
    event.preventDefault();
    onCreate(name.trim() || null);
  }
  return <Modal open onClose={onClose} title="Name gateway key" subtitle="Optional. Leave blank to create an unnamed key." size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form={formId} type="submit" variant="primary">Create key</Button></>}><form id={formId} onSubmit={submit}><Input label="Key name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional descriptive name" autoFocus /></form></Modal>;
}

export function InstancesPanel({ instances, loading, testResults, onCreate, onToggle, onTest, onConnect, onEdit, onDelete }) {
  return <Card padding={false}><CardHeader icon="dns" title="Instances" subtitle={`${instances.length} registered`} /><CardContent>
    {loading ? <div className="flex items-center gap-2 py-8 text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin motion-reduce:animate-none">progress_activity</span>Loading instances…</div> : instances.length === 0 ? <EmptyState icon="dns" title="No instances yet" message="Register an upstream MCP server to expose its tools through this gateway." action={{ label: "New instance", icon: "add", onClick: onCreate }} /> : <div className="flex flex-col gap-3">{instances.map((instance) => <InstanceRow key={instance.id} instance={instance} test={testResults[instance.id]} onToggle={onToggle} onTest={onTest} onConnect={onConnect} onEdit={onEdit} onDelete={onDelete} />)}</div>}
  </CardContent></Card>;
}
export function InstanceRow({ instance, test, onToggle, onTest, onConnect, onEdit, onDelete }) {
  const endpoint = instance.transport === "stdio" ? `${instance.command} ${(Array.isArray(instance.args) ? instance.args : []).join(" ")}` : instance.url;
  const failedLogin = /requires re-login|upstream 40[13]/.test(test?.error ?? "");
  return <article className="flex flex-col gap-4 rounded-dd-lg border border-dd-border-subtle bg-dd-bg-alt p-4 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-semibold text-dd-text">{instance.slug}</span><Badge size="sm" tone="neutral">{instance.kind}</Badge><Badge size="sm" tone="neutral">{instance.transport}</Badge>{instance.oauth ? <Badge size="sm" tone="info" icon="lock">OAuth</Badge> : null}<StatusBadge instance={instance} /></div><p className="mt-2 truncate font-mono text-xs text-dd-muted" title={endpoint}>{endpoint}</p>{test && !test.loading ? <TestResult test={test} onConnect={() => onConnect(instance.id)} showLogin={failedLogin} /> : null}</div><div className="flex flex-wrap items-center gap-1 border-t border-dd-border-subtle pt-3 lg:border-s lg:border-t-0 lg:ps-4 lg:pt-0"><Toggle size="sm" checked={Boolean(instance.enabled)} onChange={(value) => onToggle(instance.id, value)} aria-label={instance.enabled ? "Disable instance" : "Enable instance"} /><Button size="sm" variant="secondary" icon="play_arrow" loading={test?.loading} onClick={() => onTest(instance.id)}>Test</Button>{instance.oauth ? <Button size="sm" variant="secondary" icon="login" onClick={() => onConnect(instance.id)}>{instance.oauthStatus === "connected" ? "Re-login" : "Login"}</Button> : null}<Tooltip content="Edit instance"><IconButton icon="edit" label={`Edit ${instance.slug}`} onClick={() => onEdit(instance)} /></Tooltip><Tooltip content="Delete instance"><IconButton icon="delete" label={`Delete ${instance.slug}`} onClick={() => onDelete(instance.id)} /></Tooltip></div></article>;
}
export function TestResult({ test, onConnect, showLogin }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="status">{test.ok ? <><StatusDot tone="success" label={`${test.toolCount} tools discovered`} />{test.sample?.length ? <span className="text-dd-muted">Sample: {test.sample.map((sample) => sample.name).join(", ")}</span> : null}</> : <><StatusDot tone="danger" label={`Test failed: ${test.error}`} />{showLogin ? <Button size="sm" variant="secondary" icon="login" onClick={onConnect}>Login</Button> : null}</>}</div>;
}
export function KeysPanel({ keys, loading, copied, onCreate, onEdit, onReveal, onDelete }) {
  return <Card padding={false}><CardHeader icon="vpn_key" title="Gateway keys" subtitle="API keys harnesses use to talk to this gateway" /><CardContent>{loading ? <div className="flex items-center gap-2 py-8 text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin motion-reduce:animate-none">progress_activity</span>Loading keys…</div> : keys.length === 0 ? <EmptyState icon="key" title="No gateway keys yet" message="Mint a key for each harness that needs access to this gateway." action={{ label: "New key", icon: "vpn_key", onClick: onCreate }} /> : <div className="flex flex-col gap-3">{keys.map((key) => <KeyRow key={key.id} gatewayKey={key} copied={copied} onEdit={onEdit} onReveal={onReveal} onDelete={onDelete} />)}</div>}</CardContent></Card>;
}
export function KeyRow({ gatewayKey, copied, onEdit, onReveal, onDelete }) {
  return <article className="flex flex-col gap-3 rounded-dd-lg border border-dd-border-subtle bg-dd-bg-alt p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="font-medium text-dd-text">{gatewayKey.name ?? <span className="text-dd-muted">Unnamed key</span>}</p><p className="mt-1 text-xs text-dd-muted">{gatewayKey.machineId ? `Machine ${gatewayKey.machineId.slice(0, 8)}… · ` : ""}Created {gatewayKey.createdAt?.slice(0, 10) ?? "unknown"}</p></div><div className="flex items-center gap-1"><Tooltip content="Manage instance grants"><IconButton icon="tune" label="Manage grants" onClick={() => onEdit(gatewayKey.id)} /></Tooltip><Button size="sm" variant="secondary" icon={copied === `reveal_${gatewayKey.id}` ? "check" : "content_copy"} onClick={() => onReveal(gatewayKey.id)}>{copied === `reveal_${gatewayKey.id}` ? "Copied" : "Copy key"}</Button><Tooltip content="Delete key"><IconButton icon="delete" label="Delete key" onClick={() => onDelete(gatewayKey.id)} /></Tooltip></div></article>;
}
export function CreatedKeyDialog({ createdKey, copied, copy, onClose }) {
  return <Modal open onClose={onClose} title="Gateway key created" subtitle="Copy this value now. It will not be shown again." size="md" footer={<Button variant="primary" onClick={onClose}>Done</Button>}><div className="flex flex-col gap-3 sm:flex-row sm:items-start"><code className="min-w-0 flex-1 break-all rounded-dd bg-dd-surface-2 p-3 font-mono text-xs text-dd-text">{createdKey.key}</code><Button variant="secondary" icon={copied === "created-key" ? "check" : "content_copy"} onClick={() => copy(createdKey.key, "created-key")}>{copied === "created-key" ? "Copied" : "Copy"}</Button></div></Modal>;
}
export function InstanceEditModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({ ...emptyInstance(), ...initial });
  const isHttpLike = form.transport === "http" || form.transport === "sse";
  const patch = (value) => setForm((current) => ({ ...current, ...value }));
  return <Modal open onClose={onClose} title={form.id ? "Edit instance" : "New instance"} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={() => onSave(form)}>Save</Button></>}><div className="flex flex-col gap-4">{!form.id ? <div className="flex flex-wrap items-center gap-2 rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-muted"><span>Preset</span><Button size="sm" variant="secondary" onClick={() => patch({ slug: "zai-search", title: "Z.AI Web Search", kind: "http", transport: "http", url: "https://api.z.ai/api/mcp/web_search_prime/mcp" })}>Z.AI MCP</Button></div> : null}<div className="grid gap-4 sm:grid-cols-2"><Input label="Slug" required value={form.slug} onChange={(event) => patch({ slug: event.target.value.toLowerCase() })} placeholder="jira-acme" hint="Lowercase letters, digits, dashes; 2–40 characters; no __." /><Input label="Title" value={form.title} onChange={(event) => patch({ title: event.target.value })} placeholder="Jira (Acme)" /></div><div className="grid gap-4 sm:grid-cols-2"><FormSelect label="Kind" value={form.kind} options={KIND_OPTIONS} onChange={(value) => patch({ kind: value })} /><FormSelect label="Transport" value={form.transport} options={TRANSPORT_OPTIONS} onChange={(value) => patch({ transport: value })} /></div>{isHttpLike ? <><Input label="URL" required value={form.url} onChange={(event) => patch({ url: event.target.value })} placeholder="https://mcp.example.com/mcp" /><Input label="Headers (JSON object)" value={form.headers} onChange={(event) => patch({ headers: event.target.value })} hint="Merged into each request; cannot override Content-Type, Accept, or mcp-* headers." /><Input label="Provider connection ID (optional)" value={form.providerConnectionId || ""} onChange={(event) => patch({ providerConnectionId: event.target.value || undefined })} placeholder="e.g. conn-…" hint="Resolves stored z.ai API credentials for supported MCP URLs." /></> : <><Input label="Command" required value={form.command} onChange={(event) => patch({ command: event.target.value })} placeholder="npx" /><Input label="Args (JSON array)" value={form.args} onChange={(event) => patch({ args: event.target.value })} hint={'e.g. ["-y", "@browsermcp/mcp@latest"]'} /><Input label="Env (JSON object)" value={form.env} onChange={(event) => patch({ env: event.target.value })} hint={'e.g. {"API_KEY":"..."}'} /></>}<div className="grid gap-4 sm:grid-cols-2"><Toggle checked={form.oauth} onChange={(oauth) => patch({ oauth })} label="Requires OAuth" description="Instance needs browser login authorization." /><Toggle checked={form.enabled} onChange={(enabled) => patch({ enabled })} label="Enabled" description="Expose this instance through gateway." /></div></div></Modal>;
}
export function FormSelect({ label, value, options, onChange }) { return <label className="flex flex-col gap-1.5 text-xs font-medium text-dd-muted">{label}<Select value={value} options={options} onChange={onChange} aria-label={label} /></label>; }
export function GrantsModal({ keyId, allInstances, onClose, onSave }) {
  const [grants, setGrants] = useState(new Set()); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const response = await fetch(`/api/mcp-gateway/keys/${keyId}`); const body = await response.json(); setGrants(new Set(Array.isArray(body.grants) ? body.grants : [])); } finally { setLoading(false); } })(); }, [keyId]);
  function toggle(id) { setGrants((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <Modal open onClose={onClose} title="Manage instance grants" subtitle="Choose which instances this key can access." size="md" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" disabled={loading} onClick={async () => { if (await onSave(keyId, [...grants])) onClose(); }}>Save grants</Button></>}>{loading ? <div className="flex items-center gap-2 py-8 text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin motion-reduce:animate-none">progress_activity</span>Loading grants…</div> : allInstances.length === 0 ? <EmptyState icon="dns" title="No instances exist yet" message="Create an instance before assigning grants." /> : <div tabIndex={0} aria-label="Available instances" className="flex max-h-96 flex-col gap-1 overflow-y-auto" role="region">{allInstances.map((instance) => <Checkbox key={instance.id} checked={grants.has(instance.id)} onChange={() => toggle(instance.id)} label={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px]">{instance.slug}</span><Badge size="sm" tone="neutral">{instance.kind}</Badge></span>} />)}</div>}</Modal>;
}
