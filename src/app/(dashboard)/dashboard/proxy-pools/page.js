"use client";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { useNotificationStore } from "@/store/notificationStore";


function getStatusTone(status) {
  if (status === "active") return "success";
  if (status === "error") return "danger";
  return "neutral";
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function normalizeFormData(data = {}) {
  return {
    name: data.name || "",
    proxyUrl: data.proxyUrl || "",
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

export default function ProxyPoolsPage() {
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [showVercelModal, setShowVercelModal] = useState(false);
  const [showCloudflareModal, setShowCloudflareModal] = useState(false);
  const [showRelayMenu, setShowRelayMenu] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [vercelForm, setVercelForm] = useState({ vercelToken: "", projectName: "vercel-relay" });
  const [cloudflareForm, setCloudflareForm] = useState({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthProgress, setHealthProgress] = useState({ current: 0, total: 0 });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [showDeleteDeadModal, setShowDeleteDeadModal] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState(new Set());
  const [confirmPending, setConfirmPending] = useState(false);
  const relayMenuRef = useRef(null);
  const notify = useNotificationStore();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (relayMenuRef.current && !relayMenuRef.current.contains(e.target)) {
        setShowRelayMenu(false);
      }
    };
    if (showRelayMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRelayMenu]);

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.log("Error fetching proxy pools:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProxyPools();
  }, [fetchProxyPools]);

  const resetForm = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (proxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    if (saving) return;
    setShowFormModal(false);
    resetForm();
  };
  const handleSave = async () => {
    const payload = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const res = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchProxyPools();
        setShowFormModal(false);
        resetForm();
        notify.success(editingProxyPool ? "Proxy pool updated" : "Proxy pool created");
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      console.log("Error saving proxy pool:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool) => {
    setConfirmState({
      title: "Delete Proxy Pool",
      message: `Delete proxy pool "${proxyPool.name}"?`,
      confirmLabel: "Delete proxy pool",
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
          if (res.ok) {
            setProxyPools((prev) => prev.filter((item) => item.id !== proxyPool.id));
            notify.success("Proxy pool deleted");
            return;
          }
          const data = await res.json();
          if (res.status === 409) notify.warning(`Cannot delete: ${data.boundConnectionCount || 0} connection(s) are still using this pool.`);
          else notify.error(data.error || "Failed to delete proxy pool");
        } catch (error) {
          console.log("Error deleting proxy pool:", error);
          notify.error("Failed to delete proxy pool");
        }
      },
    });
  };

  const handleTest = async (proxyPoolId) => {
    setTestingId(proxyPoolId);
    try {
      const res = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        notify.error(data.error || "Failed to test proxy");
        return;
      }

      await fetchProxyPools();
        if (data.ok) {
          notify.success("Proxy test passed");
        } else {
          notify.error("Proxy test failed");
        }
    } catch (error) {
      console.log("Error testing proxy pool:", error);
      notify.error("Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleActive = async (pool) => {
    const next = !pool.isActive;
    setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: next } : p));
    try {
      const res = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
        notify.error("Failed to update active state");
      }
    } catch (error) {
      console.log("Error toggling active:", error);
      setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
    }
  };

  const allSelected = proxyPools.length > 0 && selectedIds.length === proxyPools.length;
  const toggleSelect = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : proxyPools.map((p) => p.id));
  const clearSelection = () => setSelectedIds([]);

  const bulkSetActive = async (isActive) => {
    const targets = selectedIds.length > 0 ? selectedIds : proxyPools.map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0; let failed = 0;
      for (const id of targets) {
        try {
          const res = await fetch(`/api/proxy-pools/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive }),
          });
          if (res.ok) ok += 1; else failed += 1;
        } catch { failed += 1; }
      }
      await fetchProxyPools();
      notify.success(`${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: "Delete Proxy Pools",
      message: `Delete ${selectedIds.length} proxy pool(s)?`,
      confirmLabel: "Delete proxy pools",
      onConfirm: async () => {
        setBulkBusy(true);
        try {
          let ok = 0; let blocked = 0; let failed = 0;
          for (const id of selectedIds) {
            try {
              const res = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" });
              if (res.ok) ok += 1;
              else if (res.status === 409) blocked += 1;
              else failed += 1;
            } catch { failed += 1; }
          }
          await fetchProxyPools();
          clearSelection();
          notify.success(`Deleted ${ok}${blocked ? `, ${blocked} bound` : ""}${failed ? `, ${failed} failed` : ""}`);
        } finally {
          setBulkBusy(false);
        }
      },
    });
  };

  const handleHealthCheck = async () => {
    const targets = selectedIds.length > 0
      ? proxyPools.filter((p) => selectedIds.includes(p.id))
      : proxyPools;
    if (targets.length === 0) return;
    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });
    let alive = 0; const deadIds = [];
    let done = 0;
    const CONCURRENCY = 10;
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const pool = queue.shift();
        if (!pool) break;
        try {
          const res = await fetch(`/api/proxy-pools/${pool.id}/test`, { method: "POST" });
          const data = await res.json();
          if (res.ok && data.ok) alive += 1; else deadIds.push(pool.id);
        } catch {
          deadIds.push(pool.id);
        } finally {
          done += 1;
          setHealthProgress({ current: done, total: targets.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    await fetchProxyPools();
    setHealthChecking(false);
    setHealthProgress({ current: 0, total: 0 });

    if (deadIds.length > 0) {
      setConfirmState({
        title: "Disable Dead Proxies",
        message: `Alive: ${alive}, Dead: ${deadIds.length}.\n\nDisable ${deadIds.length} dead proxies?`,
        confirmLabel: "Disable dead proxies",
        onConfirm: async () => {
          setBulkBusy(true);
          try {
            for (const id of deadIds) {
              try {
                await fetch(`/api/proxy-pools/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ isActive: false }),
                });
              } catch {}
            }
            await fetchProxyPools();
            notify.success(`Disabled ${deadIds.length} dead proxies`);
          } finally {
            setBulkBusy(false);
          }
        },
      });
    } else {
      notify.success(`Health check done. Alive: ${alive}, Dead: ${deadIds.length}`);
    }
  };

  // Cleanup selectedIds when pools change
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => proxyPools.some((p) => p.id === id)));
  }, [proxyPools]);

  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  const closeBatchImportModal = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };

  const openVercelModal = () => {
    setVercelForm({ vercelToken: "", projectName: "vercel-relay" });
    setShowVercelModal(true);
  };

  const closeVercelModal = () => {
    if (deploying) return;
    setShowVercelModal(false);
  };

  const openCloudflareModal = () => {
    setCloudflareForm({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
    setShowCloudflareModal(true);
  };

  const closeCloudflareModal = () => {
    if (deploying) return;
    setShowCloudflareModal(false);
  };

  const handleVercelDeploy = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/vercel-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vercelForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        setShowVercelModal(false);
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Vercel relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleCloudflareDeploy = async () => {
    if (!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/cloudflare-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cloudflareForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        setShowCloudflareModal(false);
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Cloudflare relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const parseProxyLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (trimmed.includes("://")) {
      const parsed = new URL(trimmed);
      const hostLabel = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${hostLabel}`,
      };
    }

    const parts = trimmed.split(":");
    if (parts.length === 4) {
      const [host, port, username, password] = parts;
      if (!host || !port || !username || !password) {
        throw new Error("Invalid host:port:user:pass format");
      }

      const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
      const parsed = new URL(proxyUrl);
      return {
        proxyUrl: parsed.toString(),
        name: `Imported ${host}:${port}`,
      };
    }

    if (parts.length === 2) {
      const [host, port] = parts;
      if (!host || !port) {
        throw new Error("Invalid host:port format");
      }
      const proxyUrl = `http://${host}:${port}`;
      return {
        proxyUrl,
        name: `Imported ${host}:${port}`,
      };
    }

    throw new Error("Unsupported format");
  };

  const handleBatchImport = async () => {
    const lines = batchImportText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      notify.warning("Please paste at least one proxy line.");
      return;
    }

    const parsedEntries = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) {
          parsedEntries.push({
            ...parsed,
            lineNumber: index + 1,
          });
        }
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });

    if (invalidLines.length > 0) {
      notify.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys = new Set(
        proxyPools.map((pool) => `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`)
      );

      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const entry of parsedEntries) {
        const dedupeKey = `${entry.proxyUrl}|||`;
        if (existingKeys.has(dedupeKey)) {
          skipped += 1;
          continue;
        }

        const res = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            proxyUrl: entry.proxyUrl,
            noProxy: "",
            isActive: true,
          }),
        });

        if (res.ok) {
          created += 1;
          existingKeys.add(dedupeKey);
        } else {
          failed += 1;
        }
      }

      await fetchProxyPools();
      setShowBatchImportModal(false);
      notify.success(`Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`);
    } catch (error) {
      console.log("Error batch importing proxies:", error);
      notify.error("Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools]
  );

  const deadProxiesList = useMemo(
    () => proxyPools.filter((pool) => pool.testStatus === "error"),
    [proxyPools]
  );

  if (loading) return <div className="mx-auto max-w-5xl space-y-4"><div className="h-24 animate-pulse rounded-dd-lg bg-dd-surface-2" /><div className="h-72 animate-pulse rounded-dd-lg bg-dd-surface-2" /></div>;

  const modalFooter = (onCancel, onSubmit, submitLabel, disabled, pending) => <><Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button><Button variant="primary" onClick={onSubmit} disabled={disabled} loading={pending}>{submitLabel}</Button></>;
  return <div className="mx-auto max-w-5xl space-y-4">
    <PageHeader icon="dns" title="Proxy Pools" subtitle="Manage outbound proxy routes and relay deployments" actions={<><Button variant="secondary" icon="upload" onClick={openBatchImportModal}>Batch import</Button><Button variant="primary" icon="add" onClick={openCreateModal}>Add proxy pool</Button></>} />
    <Card padding={false}><CardHeader icon="route" title="Configured pools" subtitle={`${proxyPools.length} total · ${activeCount} active`} actions={<div className="relative" ref={relayMenuRef}><Button variant="secondary" icon="rocket_launch" iconTrailing="expand_more" aria-expanded={showRelayMenu} onClick={() => setShowRelayMenu((open) => !open)}>Deploy relay</Button>{showRelayMenu ? <div className="absolute end-0 z-50 mt-1 w-52 rounded-dd border border-dd-border bg-dd-surface p-1 shadow-dd-elevated"><Button variant="ghost" className="w-full justify-start" icon="cloud" onClick={() => { openCloudflareModal(); setShowRelayMenu(false); }}>Cloudflare relay</Button><Button variant="ghost" className="w-full justify-start" icon="cloud_upload" onClick={() => { openVercelModal(); setShowRelayMenu(false); }}>Vercel relay</Button></div> : null}</div>} />
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><Checkbox label={allSelected ? "Unselect all" : "Select all"} checked={allSelected} onChange={toggleSelectAll} /><Badge tone="neutral">Total {proxyPools.length}</Badge><Badge tone="success">Active {activeCount}</Badge><Button variant="secondary" icon="health_and_safety" loading={healthChecking} onClick={handleHealthCheck} disabled={healthChecking || bulkBusy || !proxyPools.length}>{healthChecking ? `Checking ${healthProgress.current}/${healthProgress.total}` : "Health check"}</Button>{deadProxiesList.length ? <Button variant="danger" icon="delete" onClick={() => { setPendingDeleteIds(new Set(deadProxiesList.map((pool) => pool.id))); setShowDeleteDeadModal(true); }} disabled={bulkBusy || healthChecking}>Delete dead ({deadProxiesList.length})</Button> : null}</div>
        {selectedIds.length ? <div className="flex flex-wrap items-center gap-2 rounded-dd border border-dd-accent bg-dd-accent-soft p-3"><span className="material-symbols-outlined text-dd-accent" aria-hidden="true">checklist</span><span className="text-[13px] font-medium text-dd-accent">{`${selectedIds.length} selected`}</span><div className="ms-auto flex flex-wrap gap-2"><Button variant="secondary" icon="toggle_on" onClick={() => bulkSetActive(true)} disabled={bulkBusy || healthChecking}>Activate</Button><Button variant="secondary" icon="toggle_off" onClick={() => bulkSetActive(false)} disabled={bulkBusy || healthChecking}>Deactivate</Button><Button variant="danger" icon="delete" onClick={bulkDelete} disabled={bulkBusy || healthChecking}>Delete</Button><Button variant="ghost" onClick={clearSelection}>Clear</Button></div></div> : null}
        {!proxyPools.length ? <EmptyState icon="dns" title="No proxy pool entries yet" message="Create a proxy pool entry, then assign it to connections." action={{ label: "Add proxy pool", icon: "add", onClick: openCreateModal }} /> : <div className="divide-y divide-dd-border-subtle rounded-dd-lg border border-dd-border">{proxyPools.map((pool) => <article key={pool.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><Checkbox label={`Select ${pool.name}`} checked={selectedIds.includes(pool.id)} onChange={() => toggleSelect(pool.id)} className="shrink-0" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-[13px] font-semibold text-dd-text">{pool.name}</h2><Badge tone={getStatusTone(pool.testStatus)}>{pool.testStatus || "unknown"}</Badge><Badge tone={pool.isActive ? "success" : "neutral"}>{pool.isActive ? "active" : "inactive"}</Badge>{pool.type ? <Badge tone="neutral">{pool.type} relay</Badge> : null}<Badge tone="neutral">{pool.boundConnectionCount || 0} bound</Badge></div><p className="mt-1 truncate font-mono text-xs text-dd-muted">{pool.proxyUrl}</p>{pool.noProxy ? <p className="truncate text-xs text-dd-subtle">No proxy: {pool.noProxy}</p> : null}<p className="mt-1 text-xs text-dd-subtle">Last tested: {formatDateTime(pool.lastTestedAt)}{pool.lastError ? ` · ${pool.lastError}` : ""}</p></div><div className="flex items-center gap-1"><Toggle size="sm" checked={pool.isActive === true} onChange={() => handleToggleActive(pool)} aria-label={pool.isActive ? `Disable ${pool.name}` : `Enable ${pool.name}`} /><IconButton icon={testingId === pool.id ? "progress_activity" : "science"} label={`Test ${pool.name}`} disabled={testingId === pool.id} onClick={() => handleTest(pool.id)} /><IconButton icon="edit" label={`Edit ${pool.name}`} onClick={() => openEditModal(pool)} /><IconButton icon="delete" label={`Delete ${pool.name}`} onClick={() => handleDelete(pool)} /></div></article>)}</div>}
      </CardContent>
    </Card>
    <Modal open={showBatchImportModal} onClose={closeBatchImportModal} pending={importing} title="Batch import proxies" footer={modalFooter(closeBatchImportModal, handleBatchImport, "Import", !batchImportText.trim() || importing, importing)}><Textarea label="Paste proxy list, one per line" value={batchImportText} onChange={(event) => setBatchImportText(event.target.value)} placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass\n127.0.0.1:7897"} hint="Supported: protocol://user:pass@host:port, host:port:user:pass, host:port." /></Modal>
    <Modal open={showVercelModal} onClose={closeVercelModal} pending={deploying} title="Deploy Vercel relay" footer={modalFooter(closeVercelModal, handleVercelDeploy, "Deploy", !vercelForm.vercelToken.trim() || deploying, deploying)}><div className="space-y-4"><div className="rounded-dd border border-dd-info/40 bg-dd-info/10 p-3 text-[13px] text-dd-text">Deploys an edge relay function to Vercel. Requests route through Vercel&apos;s edge network; deployment token is used once and not stored.</div><Input label="Vercel API token" type="password" value={vercelForm.vercelToken} onChange={(event) => setVercelForm((form) => ({ ...form, vercelToken: event.target.value }))} /><Input label="Project name" value={vercelForm.projectName} onChange={(event) => setVercelForm((form) => ({ ...form, projectName: event.target.value }))} hint="Leave empty for an auto-generated name." /></div></Modal>
    <Modal open={showCloudflareModal} onClose={closeCloudflareModal} pending={deploying} title="Deploy Cloudflare relay" footer={modalFooter(closeCloudflareModal, handleCloudflareDeploy, "Deploy worker", !cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim() || deploying, deploying)}><div className="space-y-4"><div className="rounded-dd border border-dd-info/40 bg-dd-info/10 p-3 text-[13px] text-dd-text">Deploys a Cloudflare Worker relay. Requires Account ID and a Workers API token with Edit permission.</div><Input label="Account ID" value={cloudflareForm.accountId} onChange={(event) => setCloudflareForm((form) => ({ ...form, accountId: event.target.value }))} /><Input label="API token" type="password" value={cloudflareForm.apiToken} onChange={(event) => setCloudflareForm((form) => ({ ...form, apiToken: event.target.value }))} /><Input label="Worker name" value={cloudflareForm.projectName} onChange={(event) => setCloudflareForm((form) => ({ ...form, projectName: event.target.value }))} /></div></Modal>
    <Modal open={showFormModal} onClose={closeFormModal} pending={saving} title={editingProxyPool ? "Edit proxy pool" : "Add proxy pool"} footer={modalFooter(closeFormModal, handleSave, "Save", !formData.name.trim() || !formData.proxyUrl.trim() || saving, saving)}><div className="space-y-4"><Input label="Name" value={formData.name} onChange={(event) => setFormData((form) => ({ ...form, name: event.target.value }))} /><Input label="Proxy URL" value={formData.proxyUrl} onChange={(event) => setFormData((form) => ({ ...form, proxyUrl: event.target.value }))} /><Input label="No proxy" value={formData.noProxy} onChange={(event) => setFormData((form) => ({ ...form, noProxy: event.target.value }))} hint="Comma-separated hosts/domains to bypass proxy." /><Toggle label="Active" description="Inactive pools are ignored by runtime resolution." checked={formData.isActive} onChange={(isActive) => setFormData((form) => ({ ...form, isActive }))} disabled={saving} /><Toggle label="Strict proxy" description="Fail when proxy is unreachable instead of falling back to direct." checked={formData.strictProxy} onChange={(strictProxy) => setFormData((form) => ({ ...form, strictProxy }))} disabled={saving} /></div></Modal>
    <Modal open={showDeleteDeadModal} onClose={() => { if (!bulkBusy) setShowDeleteDeadModal(false); }} pending={bulkBusy} title="Delete dead proxies" footer={modalFooter(() => setShowDeleteDeadModal(false), async () => { setBulkBusy(true); try { let ok = 0; let blocked = 0; let failed = 0; for (const id of pendingDeleteIds) { try { const res = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" }); if (res.ok) ok += 1; else if (res.status === 409) blocked += 1; else failed += 1; } catch { failed += 1; } } await fetchProxyPools(); clearSelection(); setShowDeleteDeadModal(false); notify.success(`Deleted ${ok}${blocked ? `, ${blocked} bound` : ""}${failed ? `, ${failed} failed` : ""}`); } finally { setBulkBusy(false); } }, `Delete ${pendingDeleteIds.size}`, !pendingDeleteIds.size || bulkBusy, bulkBusy)}><div className="space-y-2"><p className="text-[13px] text-dd-muted">Remove any proxy to keep before deleting selected failures.</p>{deadProxiesList.map((proxy) => { const selected = pendingDeleteIds.has(proxy.id); return <div key={proxy.id} className="flex items-center justify-between gap-3 rounded-dd border border-dd-border-subtle p-3"><div className="min-w-0"><p className={selected ? "truncate text-[13px] font-medium text-dd-text" : "truncate text-[13px] text-dd-subtle line-through"}>{proxy.name}</p><p className="truncate font-mono text-xs text-dd-muted">{proxy.proxyUrl}</p></div><IconButton icon={selected ? "close" : "undo"} label={selected ? `Keep ${proxy.name}` : `Delete ${proxy.name}`} disabled={bulkBusy} onClick={() => setPendingDeleteIds((ids) => { const next = new Set(ids); if (selected) next.delete(proxy.id); else next.add(proxy.id); return next; })} /></div>; })}</div></Modal>
    <ConfirmDialog open={!!confirmState} title={confirmState?.title || "Confirm"} message={confirmState?.message} confirmLabel={confirmState?.confirmLabel || "Confirm"} tone={confirmState?.tone || "danger"} pending={confirmPending} onConfirm={async () => { setConfirmPending(true); try { await confirmState?.onConfirm?.(); setConfirmState(null); } finally { setConfirmPending(false); } }} onCancel={() => { if (!confirmPending) setConfirmState(null); }} />
  </div>;
}
