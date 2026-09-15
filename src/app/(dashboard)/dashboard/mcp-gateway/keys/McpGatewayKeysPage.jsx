"use client";

/**
 * MCP Gateway — Keys.
 *
 * Split out of the combined gateway page so minting or revoking a harness key
 * does not reload the instance list, and so a key can be revoked without
 * scrolling past instance configuration.
 *
 * This page fetches instances as well as keys, but never renders them as a
 * section: a key's grants name instances, so `GrantsModal` needs the list to
 * offer checkboxes. That fetch is the modal's dependency, not a second
 * section, and it is what makes the split a real separation rather than two
 * copies of the same page.
 */

import { useState } from "react";
import Link from "next/link";
import Button from "@/shared/ui/components/Button.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { CreatedKeyDialog, GrantsModal, KeysPanel, NewKeyDialog } from "../McpGatewayComponents.jsx";
import { useGatewayCollection } from "../shared.js";

export default function McpGatewayKeysPage() {
  const { items: keys, loading, reload, notify } = useGatewayCollection("/api/mcp-gateway/keys", "keys");
  // Grants are expressed in terms of instances, so the modal needs the list —
  // but only once the operator opens it. Loading instances on mount would let
  // an unrelated instance-endpoint failure raise an error toast on a page
  // whose own list is fine, and revoking a key must not be blocked or
  // distracted by that.
  const { items: instances, reload: loadInstances } = useGatewayCollection("/api/mcp-gateway/instances", "instances", { eager: false });
  const [editingKey, setEditingKey] = useState(null);
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [keyPromptOpen, setKeyPromptOpen] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  async function createKey(name = null) {
    const res = await fetch("/api/mcp-gateway/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { notify({ type: "error", message: body.error ?? "create failed" }); return; }
    setKeyPromptOpen(false); setCreatedKey(body.key ?? null); await reload();
  }
  async function revealAndCopyKey(id) {
    const res = await fetch(`/api/mcp-gateway/keys/${id}/reveal`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.key) { notify({ type: "error", message: body.error ?? "reveal failed" }); return; }
    copy(body.key, `reveal_${id}`);
  }
  async function deleteKey(id) {
    const res = await fetch(`/api/mcp-gateway/keys/${id}`, { method: "DELETE" });
    if (!res.ok) { const body = await res.json().catch(() => ({})); notify({ type: "error", message: body.error ?? "delete failed" }); return; }
    notify({ type: "success", message: "Key deleted" }); setConfirmDelete(null); setEditingKey(null); await reload();
  }
  async function saveGrants(keyId, instanceIds) {
    const res = await fetch(`/api/mcp-gateway/keys/${keyId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grants: instanceIds }) });
    if (!res.ok) { const body = await res.json().catch(() => ({})); notify({ type: "error", message: body.error ?? "save failed" }); return false; }
    notify({ type: "success", message: "Grants updated" });
    return true;
  }
  // Open the modal first, then fetch: the picker shows its own loading state,
  // and a slow instances endpoint must not stall the click.
  function openGrants(keyId) {
    setEditingKey(keyId);
    loadInstances();
  }

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 text-[13px]">
    <PageHeader icon="vpn_key" title="Gateway Keys" subtitle="API keys harnesses use to talk to this gateway. Each key reaches only the instances it is granted." actions={<><Link href="/dashboard/mcp-gateway" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined text-base">hub</span>Instances</Link><Button variant="primary" icon="vpn_key" onClick={() => setKeyPromptOpen(true)}>New key</Button></>} />
    <KeysPanel keys={keys} loading={loading} copied={copied} onCreate={() => setKeyPromptOpen(true)} onEdit={openGrants} onReveal={revealAndCopyKey} onDelete={(id) => setConfirmDelete({ kind: "key", id })} />
    {keyPromptOpen ? <NewKeyDialog onClose={() => setKeyPromptOpen(false)} onCreate={createKey} /> : null}
    {editingKey ? <GrantsModal keyId={editingKey} allInstances={instances} onClose={() => setEditingKey(null)} onSave={saveGrants} /> : null}
    {createdKey ? <CreatedKeyDialog createdKey={createdKey} copied={copied} copy={copy} onClose={() => setCreatedKey(null)} /> : null}
    <ConfirmDialog open={confirmDelete?.kind === "key"} title="Delete gateway key?" message="Any harness using this key will lose access immediately." confirmLabel="Delete key" onConfirm={() => deleteKey(confirmDelete.id)} onCancel={() => setConfirmDelete(null)} />
  </main>;
}
