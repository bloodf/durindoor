"use client";

import { useEffect, useState, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import { filterApiKeys, groupLabelsForKey } from "./apiKeyFilters";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import StatusAlert from "../endpoint/components/StatusAlert";
import ApiKeyPolicyFields from "../endpoint/components/ApiKeyPolicyFields";
import { KeyUsageSummary, KeyLimitsModal } from "../endpoint/components/ApiKeyLimits";
import ApiKeyModelAccessModal from "../endpoint/ApiKeyModelAccessModal";
import { KEY_USAGE_POLL_MS } from "../endpoint/endpointConstants";
import {
  apiKeyPolicyDraftToPayload,
  apiKeyPolicyPatchFromDraft,
  apiKeyPolicyToDraft,
  emptyApiKeyPolicyDraft,
  formatPolicyUsage,
  isEditableApiKeyPolicy,
} from "../endpoint/apiKeyPolicy";
import {
  API_KEY_EXPIRY_PRESETS,
  expiryFromSelection,
  expirySelectionFromValue,
  formatKeyExpiry,
} from "../endpoint/apiKeyExpiry";

function ApiKeyRow({ apiKey, groupLabels = [], onToggle, onReveal, onEdit, onDelete, onModelAccess, onLimits, keyUsage, copied, policyInvalid, policyUsage }) {
  const active = apiKey.isActive ?? true;
  const expiry = formatKeyExpiry(apiKey.expiresAt);
  const overflowReached = policyUsage.tokensExceeded || policyUsage.costExceeded;
  return (
    <div
      className={`group flex flex-col gap-3 rounded-dd-lg px-3 py-3 transition-colors hover:bg-dd-surface-2 sm:flex-row sm:items-start ${
        active ? "" : "opacity-60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-dd-text">{apiKey.name}</p>
          <Badge tone={active ? "success" : "warning"} size="sm">
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className={`block size-1.5 rounded-full ${active ? "bg-dd-success" : "bg-dd-warning"}`} />
              {active ? "Active" : "Paused"}
            </span>
          </Badge>
          {groupLabels.map((label) => (
            <Badge key={label} tone="accent" size="sm">{label}</Badge>
          ))}
          {apiKey.policy?.modelAccess?.mode === "allow" ? (
            <Badge tone="accent" size="sm" title={apiKey.policy.modelAccess.patterns.join(", ")}>
              Allow: {apiKey.policy.modelAccess.patterns.length} rules
            </Badge>
          ) : null}
          {apiKey.policy?.modelAccess?.mode === "deny" ? (
            <Badge tone="warning" size="sm" title={apiKey.policy.modelAccess.patterns.join(", ")}>
              Blocked: {apiKey.policy.modelAccess.patterns.length} rules
            </Badge>
          ) : null}
        </div>
        <code className="mt-1 block font-mono text-xs text-dd-muted">{apiKey.maskedKey || "***"}</code>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-dd bg-dd-surface-2 px-1.5 py-0.5 text-dd-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">schedule</span>
            Created {new Date(apiKey.createdAt).toLocaleDateString()}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-dd px-1.5 py-0.5 ${
              expiry.danger
                ? "border border-dd-danger/30 bg-dd-danger/10 text-dd-danger"
                : "bg-dd-surface-2 text-dd-muted"
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">event</span>
            {expiry.text}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-dd px-1.5 py-0.5 ${
              policyInvalid || overflowReached
                ? "border border-dd-danger/30 bg-dd-danger/10 text-dd-danger"
                : "bg-dd-surface-2 text-dd-muted"
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">tune</span>
            {policyInvalid
              ? "Invalid policy"
              : `Models: ${apiKey.policy?.allowedModels?.length ? apiKey.policy.allowedModels.length : "All"}`}
          </span>
          <span className="inline-flex items-center gap-1 rounded-dd bg-dd-surface-2 px-1.5 py-0.5 text-dd-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">data_usage</span>
            <span className="dd-tnum">{policyUsage.tokens} tok · {policyUsage.cost}</span>
            {overflowReached ? " · limit reached" : ""}
          </span>
          <span className="inline-flex items-center gap-1 rounded-dd bg-dd-surface-2 px-1.5 py-0.5 text-dd-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">speed</span>
            {apiKey.dailyLimitTokens == null ? "No daily limit" : `${apiKey.dailyLimitTokens.toLocaleString()}/day`}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-dd-muted">Combos:</span>
          {Array.isArray(apiKey.allowedCombos) && apiKey.allowedCombos.length > 0 ? (
            apiKey.allowedCombos.map((c) => (
              <span
                key={c}
                className="rounded-dd bg-dd-accent-soft px-1.5 py-0.5 text-[11px] text-dd-accent"
              >
                {c}
              </span>
            ))
          ) : (
            <span className="rounded-dd bg-dd-accent-soft px-1.5 py-0.5 text-[11px] text-dd-accent">All</span>
          )}
        </div>
        {keyUsage && <KeyUsageSummary usage={keyUsage} />}
      </div>
      <div className="flex w-full shrink-0 justify-end gap-1 sm:w-auto">
        <Toggle
          size="sm"
          checked={active}
          onChange={(checked) => onToggle(apiKey, checked)}
          aria-label={active ? `Pause ${apiKey.name}` : `Resume ${apiKey.name}`}
        />
        <IconButton
          icon="vpn_key"
          label={`Model access for ${apiKey.name}`}
          variant="ghost"
          size="md"
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => onModelAccess(apiKey)}
        />
        <IconButton
          icon="speed"
          label={`Limits for ${apiKey.name}`}
          variant="ghost"
          size="md"
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => onLimits(apiKey)}
        />
        <IconButton
          icon={copied === `reveal_${apiKey.id}` ? "check" : "content_copy"}
          label={`Reveal and copy ${apiKey.name}`}
          variant="ghost"
          size="md"
          className={`opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 ${
            copied === `reveal_${apiKey.id}` ? "text-dd-success" : ""
          }`}
          onClick={() => onReveal(apiKey.id)}
        />
        <IconButton
          icon="edit"
          label={`Edit ${apiKey.name}`}
          variant="ghost"
          size="md"
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => onEdit(apiKey)}
        />
        <IconButton
          icon="delete"
          label={`Delete ${apiKey.name}`}
          variant="ghost"
          size="md"
          className="text-dd-danger opacity-100 hover:bg-dd-danger/10 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={() => onDelete(apiKey.id)}
        />
      </div>
    </div>
  );
}

ApiKeyRow.propTypes = {
  apiKey: PropTypes.object.isRequired,
  onToggle: PropTypes.func.isRequired,
  onReveal: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onModelAccess: PropTypes.func.isRequired,
  onLimits: PropTypes.func.isRequired,
  keyUsage: PropTypes.object,
  copied: PropTypes.string,
  policyInvalid: PropTypes.bool,
  policyUsage: PropTypes['shape']({ tokens: PropTypes.string, cost: PropTypes.string, tokensExceeded: PropTypes.bool, costExceeded: PropTypes.bool }),
};

function emptyAddKeyPolicy() {
  return emptyApiKeyPolicyDraft();
}

export default function KeysPageClient() {
  const [keys, setKeys] = useState([]);
  const [keyUsage, setKeyUsage] = useState({});
  const [limitsKey, setLimitsKey] = useState(null);
  const [modelAccessKey, setModelAccessKey] = useState(null);
  const [providerConnections, setProviderConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [search, setSearch] = useState("");
  const [groupPrompt, setGroupPrompt] = useState(null);
  const [groupConfirm, setGroupConfirm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyDailyLimitTokens, setNewKeyDailyLimitTokens] = useState("");
  const [newKeyExpiryPreset, setNewKeyExpiryPreset] = useState("never");
  const [newKeyCustomExpiresAt, setNewKeyCustomExpiresAt] = useState("");
  const [keyStatus, setKeyStatus] = useState(null);
  const [createdKey, setCreatedKey] = useState(null);
  const [createdKeyExpiresAt, setCreatedKeyExpiresAt] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [combos, setCombos] = useState([]);
  const [newKeyAllowedCombos, setNewKeyAllowedCombos] = useState([]);
  const [policyCatalog, setPolicyCatalog] = useState([]);
  const [policyCatalogLoading, setPolicyCatalogLoading] = useState(true);
  const [newKeyPolicy, setNewKeyPolicy] = useState(emptyAddKeyPolicy);
  const [newKeyProviderConnectionIds, setNewKeyProviderConnectionIds] = useState([]);
  const [editKey, setEditKey] = useState(null);
  const [editKeyAllowedCombos, setEditKeyAllowedCombos] = useState([]);
  const [editKeyExpiryPreset, setEditKeyExpiryPreset] = useState("never");
  const [editKeyDailyLimitTokens, setEditKeyDailyLimitTokens] = useState("");
  const [editKeyCustomExpiresAt, setEditKeyCustomExpiresAt] = useState("");
  const [editKeyStatus, setEditKeyStatus] = useState(null);
  const [editKeyPolicy, setEditKeyPolicy] = useState(emptyAddKeyPolicy);
  const [editKeyProviderConnectionIds, setEditKeyProviderConnectionIds] = useState([]);
  const [editKeyGroupIds, setEditKeyGroupIds] = useState([]);
  const [editKeyPolicyDirty, setEditKeyPolicyDirty] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const fetchKeyUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/keys/usage", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setKeyUsage(data.usage || {});
    } catch { /* usage meters are best-effort */ }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    fetchPolicyCatalog();
    fetchKeyUsage();
    const timer = setInterval(fetchKeyUsage, KEY_USAGE_POLL_MS);
    return () => clearInterval(timer);
  }, [fetchKeyUsage]);

  const handleSaveLimits = async (id, limits) => {
    const res = await fetch(`/api/keys/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(limits),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to save limits");
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, ...data.key } : k)));
    fetchKeyUsage();
  };

  const handleSaveModelAccess = (updatedKey) => {
    if (!updatedKey) return;
    setKeys((prev) => prev.map((k) => (k.id === updatedKey.id ? { ...k, ...updatedKey } : k)));
  };

  const fetchData = async () => {
    setLoadError("");
    try {
      const [keysRes, combosRes] = await Promise.all([
        fetch("/api/keys"),
        fetch("/api/combos"),
      ]);
      const keysData = await keysRes.json();
      if (keysRes.ok) {
        setProviderConnections(keysData.providerConnections || []);
        setKeys(keysData.keys || []);
        setGroups(keysData.groups || []);
      } else {
        setLoadError(keysData.error || `API key request failed (${keysRes.status})`);
      }
      if (combosRes.ok) {
        const combosData = await combosRes.json();
        setCombos(combosData.combos || combosData || []);
      }
    } catch (error) {
      console.log("Error fetching data:", error);
      setLoadError(error.message || "Unable to load API keys");
    }
  };


  /**
   * Re-read groups and key membership from the server after a write was
   * rejected for naming a group that no longer exists. Returns the set of live
   * group ids, or null if the refresh itself failed — in which case the caller
   * leaves the operator's selection alone rather than silently discarding it.
   */
  const refreshGroupCatalog = async () => {
    try {
      const res = await fetch("/api/keys");
      if (!res.ok) return null;
      const data = await res.json();
      const live = data.groups || [];
      setGroups(live);
      setKeys(data.keys || []);
      const liveIds = new Set(live.map((group) => group.id));
      setSelectedGroupIds((prev) => prev.filter((id) => liveIds.has(id)));
      return liveIds;
    } catch {
      return null;
    }
  };

  const visibleKeys = filterApiKeys(keys, { selectedGroupIds, search });

  const toggleGroupFilter = (groupId) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const clearFilters = () => {
    setSelectedGroupIds([]);
    setSearch("");
  };

  const saveGroup = async (name) => {
    const editing = groupPrompt?.group || null;
    setGroupPrompt(null);
    try {
      const response = await fetch(editing ? `/api/key-groups/${editing.id}` : "/api/key-groups", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) {
        setLoadError(data.error || "Failed to save group");
        return;
      }
      setGroups((prev) =>
        editing
          ? prev.map((group) => (group.id === data.group.id ? data.group : group))
          : [...prev, data.group].sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (error) {
      setLoadError(error.message || "Failed to save group");
    }
  };

  const removeGroup = async (group) => {
    setGroupConfirm(null);
    try {
      const response = await fetch(`/api/key-groups/${group.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setLoadError(data.error || "Failed to delete group");
        return;
      }
      setGroups((prev) => prev.filter((entry) => entry.id !== group.id));
      // Drop the deleted group from the filter and from every key's badges so
      // the list does not keep filtering on something that no longer exists.
      setSelectedGroupIds((prev) => prev.filter((id) => id !== group.id));
      setKeys((prev) =>
        prev.map((key) => ({
          ...key,
          groupIds: (key.groupIds || []).filter((id) => id !== group.id),
        }))
      );
    } catch (error) {
      setLoadError(error.message || "Failed to delete group");
    }
  };
  async function fetchPolicyCatalog() {
    try {
      const response = await fetch("/api/keys/policy-catalog");
      if (response.ok) {
        const data = await response.json();
        setPolicyCatalog(data.models || []);
      }
    } catch (error) {
      console.log("Error fetching API-key policy catalog:", error);
    } finally {
      setPolicyCatalogLoading(false);
    }
  }

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const dailyLimitTokens = newKeyDailyLimitTokens.trim() === "" ? null : Number(newKeyDailyLimitTokens);
      if (dailyLimitTokens !== null && (!Number.isSafeInteger(dailyLimitTokens) || dailyLimitTokens < 0)) return;

      let expiresAt;
      let policy;
      try {
        expiresAt = expiryFromSelection(newKeyExpiryPreset, newKeyCustomExpiresAt);
        policy = apiKeyPolicyDraftToPayload(newKeyPolicy);
      } catch (error) {
        setKeyStatus({ type: "error", message: error.message });
        return;
      }

      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, allowedCombos: newKeyAllowedCombos, dailyLimitTokens, expiresAt, policy, providerConnectionIds: newKeyProviderConnectionIds }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        setCreatedKeyExpiresAt(data.expiresAt || null);
        await fetchData();
        setNewKeyName("");
        setNewKeyDailyLimitTokens("");
        setNewKeyExpiryPreset("never");
        setNewKeyCustomExpiresAt("");
        setNewKeyAllowedCombos([]);
        setNewKeyProviderConnectionIds([]);
        setNewKeyPolicy(emptyApiKeyPolicyDraft());
        setKeyStatus(null);
        setShowAddModal(false);
      } else {
        setKeyStatus({ type: "error", message: data.error || "Failed to create key" });
      }
    } catch (error) {
      console.log("Error creating key:", error);
      setKeyStatus({ type: "error", message: "Failed to create key" });
    }
  };

  const revealAndCopyKey = async (id) => {
    try {
      const res = await fetch(`/api/keys/${id}/reveal`);
      const data = await res.json();
      if (res.ok && data.key) {
        copy(data.key, `reveal_${id}`);
      } else {
        setKeyStatus({ type: "error", message: data.error || "Failed to reveal key" });
      }
    } catch {
      setKeyStatus({ type: "error", message: "Failed to reveal key" });
    }
  };

  const handleDeleteKey = (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys(keys.filter((k) => k.id !== id));
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      },
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, isActive } : k)));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const requestToggleKey = (key, checked) => {
    if (key.isActive && !checked) {
      setConfirmState({
        title: "Pause API Key",
        message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
        onConfirm: async () => {
          setConfirmState(null);
          handleToggleKey(key.id, checked);
        },
      });
      return;
    }
    handleToggleKey(key.id, checked);
  };

  const handleUpdateKeyDetails = async (id, allowedCombos, expiresAt, policyPatch, dailyLimitTokens = null, providerConnectionIds, groupIds) => {
    try {
      const payload = { allowedCombos, expiresAt, dailyLimitTokens, providerConnectionIds, groupIds };
      if (policyPatch) Object.assign(payload, policyPatch);
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? data.key : k)));
        return true;
      }
      setEditKeyStatus({ type: "error", message: data.error || "Failed to update API key" });
      // A rejected group id means this tab is holding a group that someone
      // deleted elsewhere. Nothing was written, but the stale chip is still
      // selected, so every retry would fail the same way. Re-read the catalog
      // and drop what no longer exists, leaving the modal open with the
      // operator's other edits intact.
      if (res.status === 400 && /group/i.test(data.error || "")) {
        const live = await refreshGroupCatalog();
        if (live) setEditKeyGroupIds((prev) => prev.filter((groupId) => live.has(groupId)));
      }
    } catch (error) {
      console.log("Error updating key details:", error);
      setEditKeyStatus({ type: "error", message: "Failed to update API key" });
    }
    return false;
  };

  const beginEditKey = (key) => {
    const expiry = expirySelectionFromValue(key.expiresAt);
    setEditKey(key);
    setEditKeyAllowedCombos(Array.isArray(key.allowedCombos) ? [...key.allowedCombos] : []);
    setEditKeyProviderConnectionIds(Array.isArray(key.providerConnectionIds) ? [...key.providerConnectionIds] : []);
    setEditKeyGroupIds(Array.isArray(key.groupIds) ? [...key.groupIds] : []);
    setEditKeyExpiryPreset(expiry.selection);
    setEditKeyCustomExpiresAt(expiry.customLocalValue);
    setEditKeyDailyLimitTokens(key.dailyLimitTokens == null ? "" : String(key.dailyLimitTokens));
    setEditKeyPolicy(apiKeyPolicyToDraft(key.policy));
    setEditKeyPolicyDirty(false);
    setEditKeyStatus(null);
  };


  const resetAddModal = () => {
    setShowAddModal(false);
    setNewKeyName("");
    setNewKeyDailyLimitTokens("");
    setNewKeyExpiryPreset("never");
    setNewKeyCustomExpiresAt("");
    setNewKeyAllowedCombos([]);
    setNewKeyPolicy(emptyApiKeyPolicyDraft());
    setNewKeyProviderConnectionIds([]);
    setKeyStatus(null);
  };

  const resetEditModal = () => {
    setEditKey(null);
    setEditKeyAllowedCombos([]);
    setEditKeyExpiryPreset("never");
    setEditKeyCustomExpiresAt("");
    setEditKeyDailyLimitTokens("");
    setEditKeyProviderConnectionIds([]);
    setEditKeyGroupIds([]);
    setEditKeyPolicy(emptyApiKeyPolicyDraft());
    setEditKeyPolicyDirty(false);
    setEditKeyStatus(null);
  };

  const expiryOptions = API_KEY_EXPIRY_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }));
  const addKeyProviderOptions = providerConnections
    .filter((connection) => !newKeyProviderConnectionIds.includes(connection.id))
    .map((connection) => ({
      value: connection.id,
      label: `${connection.name || connection.id} (${connection.provider})`,
    }));
  const editKeyProviderOptions = providerConnections
    .filter((connection) => !editKeyProviderConnectionIds.includes(connection.id))
    .map((connection) => ({
      value: connection.id,
      label: `${connection.name || connection.id} (${connection.provider})`,
    }));

  if (loading) {
    return <div className="h-40 rounded-dd-lg border border-dd-border bg-dd-surface" aria-label="Loading API keys" />;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        icon="vpn_key"
        title="API Keys"
        subtitle="Manage API keys and their access policies"
      />
      {loadError ? <StatusAlert status={{ type: "error", message: loadError }} /> : null}
      {/* API Keys */}
      <Card padding={false}>
        <CardHeader
          icon="vpn_key"
          title="API Keys"
          actions={
            keys.length > 0 ? (
              <Button icon="add" onClick={() => setShowAddModal(true)}>Create Key</Button>
            ) : null
          }
        />
        <CardContent>
          {keys.length > 0 ? (
            <div className="mb-4 flex flex-col gap-3 border-b border-dd-border-subtle pb-4 sm:flex-row sm:items-end">
              <Input
                label="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by key name"
                className="flex-1"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-dd-muted">Groups</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {groups.length === 0 ? (
                    <span className="text-xs text-dd-muted">No groups yet</span>
                  ) : (
                    groups.map((group) => {
                      const selected = selectedGroupIds.includes(group.id);
                      return (
                        <Button
                          key={group.id}
                          size="sm"
                          variant={selected ? "primary" : "secondary"}
                          aria-pressed={selected}
                          onClick={() => toggleGroupFilter(group.id)}
                        >
                          {group.name}
                        </Button>
                      );
                    })
                  )}
                  {selectedGroupIds.length > 0 ? (
                    <Button size="sm" variant="ghost" onClick={() => setSelectedGroupIds([])}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {keys.length === 0 ? (
            <EmptyState
              icon="vpn_key"
              title="No API keys yet"
              message="Create your first API key to get started."
              action={{ label: "Create Key", icon: "add", onClick: () => setShowAddModal(true) }}
            />
          ) : visibleKeys.length === 0 ? (
            // Distinct from "no keys": the keys exist, the filter hides them.
            // Showing the full list instead would invite acting on the wrong one.
            <EmptyState
              icon="filter_alt_off"
              title="No keys match"
              message="No API key matches the current search and group filter."
              action={{ label: "Clear filters", onClick: clearFilters }}
            />
          ) : (
            <ul className="flex flex-col">
              {visibleKeys.map((key) => {
                const policyUsage = formatPolicyUsage(key.usage, key.policy);
                const policyInvalid = !isEditableApiKeyPolicy(key.policy);
                return (
                  <li key={key.id}>
                    <ApiKeyRow
                      apiKey={key}
                      groupLabels={groupLabelsForKey(key, groups)}
                      onToggle={requestToggleKey}
                      onReveal={revealAndCopyKey}
                      onEdit={beginEditKey}
                      onDelete={handleDeleteKey}
                      onModelAccess={setModelAccessKey}
                      onLimits={setLimitsKey}
                      keyUsage={keyUsage[key.id]}
                      copied={copied}
                      policyInvalid={policyInvalid}
                      policyUsage={policyUsage}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Groups management. Kept beside the keys list rather than on its own
          page: a group only means something in relation to the keys it labels. */}
      <Card padding={false}>
        <CardHeader
          icon="label"
          title="Key Groups"
          subtitle="Organizational labels. Groups never change what a key can access."
          actions={
            <Button icon="add" onClick={() => setGroupPrompt({ group: null })}>
              New Group
            </Button>
          }
        />
        <CardContent>
          {groups.length === 0 ? (
            <EmptyState
              icon="label"
              title="No groups yet"
              message="Create a group to organize API keys by purpose."
              action={{ label: "New Group", icon: "add", onClick: () => setGroupPrompt({ group: null }) }}
            />
          ) : (
            <ul className="flex flex-col divide-y divide-dd-border-subtle">
              {groups.map((group) => {
                const memberCount = keys.filter((key) => (key.groupIds || []).includes(group.id)).length;
                return (
                  <li key={group.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-dd-text">
                      {group.name}
                    </span>
                    <Badge tone="neutral" size="sm">
                      {memberCount} {memberCount === 1 ? "key" : "keys"}
                    </Badge>
                    <IconButton
                      label={`Rename ${group.name}`}
                      icon="edit"
                      onClick={() => setGroupPrompt({ group })}
                    />
                    <IconButton
                      label={`Delete ${group.name}`}
                      icon="delete"
                      className="text-dd-danger hover:text-dd-danger"
                      onClick={() => setGroupConfirm(group)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add Key Modal */}
      <Modal
        open={showAddModal}
        title="Create API Key"
        size="lg"
        onClose={resetAddModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
            required
          />
          <Input
            label="Daily token limit"
            type="number"
            min="0"
            step="1"
            value={newKeyDailyLimitTokens}
            onChange={(e) => setNewKeyDailyLimitTokens(e.target.value)}
            placeholder="Unlimited"
          />
          <Field label="Expiry">
            <Select
              value={newKeyExpiryPreset}
              onChange={(value) => { setNewKeyExpiryPreset(value); setKeyStatus(null); }}
              options={expiryOptions}
              aria-label="Expiry preset"
            />
          </Field>
          {newKeyExpiryPreset === "custom" ? (
            <Input
              label="Custom expiry (local time)"
              type="datetime-local"
              value={newKeyCustomExpiresAt}
              onChange={(event) => { setNewKeyCustomExpiresAt(event.target.value); setKeyStatus(null); }}
            />
          ) : null}
          {combos.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <p className="text-[13px] font-semibold text-dd-text">Allowed Combos</p>
                <p className="text-xs text-dd-muted">Choose &quot;All combos&quot; for unrestricted access, or select specific combos to restrict this key.</p>
              </div>
              <div tabIndex={0} aria-label="Allowed combos for new key" className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-dd-lg border border-dd-border p-2" role="region">
                <Checkbox
                  checked={newKeyAllowedCombos.length === 0}
                  onChange={() => setNewKeyAllowedCombos([])}
                  label="All combos"
                />
                {combos.map((combo) => (
                  <Checkbox
                    key={combo.id || combo.name}
                    checked={newKeyAllowedCombos.includes(combo.name)}
                    onChange={() => {
                      setNewKeyAllowedCombos((prev) =>
                        prev.includes(combo.name)
                          ? prev.filter((c) => c !== combo.name)
                          : [...prev, combo.name]
                      );
                    }}
                    label={combo.name}
                    hint={combo.kind}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <Field label="Provider accounts" hint="Leave empty for unrestricted access.">
            <Select
              value=""
              placeholder="Add provider account"
              options={addKeyProviderOptions}
              onChange={(value) =>
                value
                  ? setNewKeyProviderConnectionIds((prev) => (prev.includes(value) ? prev : [...prev, value]))
                  : undefined
              }
            />
          </Field>
          <DataTable
            framed={false}
            ariaLabel="Scoped provider accounts for the new key"
            columns={[
              { key: "name", label: "Name" },
              { key: "provider", label: "Provider" },
              {
                key: "remove",
                label: "Actions",
                align: "right",
                render: (row) => (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setNewKeyProviderConnectionIds((prev) => prev.filter((id) => id !== row.id))
                    }
                  >
                    Remove
                  </Button>
                ),
              },
            ]}
            rows={newKeyProviderConnectionIds.map((id) => {
              const connection = providerConnections.find((item) => item.id === id) || { id, name: id, provider: "unknown" };
              return { id, name: connection.name || id, provider: connection.provider };
            })}
            keyFn={(row) => row.id}
            density="compact"
            emptyState={{ title: "No scoped accounts", message: "This key can route through every provider account." }}
          />
          <ApiKeyPolicyFields
            draft={newKeyPolicy}
            onChange={setNewKeyPolicy}
            catalog={policyCatalog}
            loading={policyCatalogLoading}
          />
          {keyStatus ? <StatusAlert status={keyStatus} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleCreateKey} disabled={!newKeyName.trim()} className="flex-1">
              Create
            </Button>
            <Button variant="ghost" onClick={resetAddModal} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        open={!!createdKey}
        title="API Key Created"
        size="md"
        onClose={() => { setCreatedKey(null); setCreatedKeyExpiresAt(null); }}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-dd-lg border border-dd-warning bg-dd-warning/10 p-4 text-dd-warning">
            <p className="mb-2 text-[13px] font-semibold">Save this key now!</p>
            <p className="text-[13px]">This is the only time you will see this key. Store it securely.</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              aria-label="Newly created API key"
              className="flex-1 font-mono text-[13px]"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-dd-muted">
            Expiry: {createdKeyExpiresAt ? new Date(createdKeyExpiresAt).toLocaleString() : "Never expires"}
          </p>
          <Button
            variant="primary"
            onClick={() => { setCreatedKey(null); setCreatedKeyExpiresAt(null); }}
          >
            Done
          </Button>
        </div>
      </Modal>

      {/* Edit key access and expiry */}
      <Modal
        open={!!editKey}
        title={`Edit API Key — ${editKey?.name || ""}`}
        size="lg"
        onClose={resetEditModal}
      >
        <div className="flex flex-col gap-4">
          <Field label="Expiry">
            <Select
              value={editKeyExpiryPreset}
              onChange={(value) => { setEditKeyExpiryPreset(value); setEditKeyStatus(null); }}
              options={expiryOptions}
              aria-label="Expiry preset"
            />
          </Field>
          {editKeyExpiryPreset === "custom" ? (
            <Input
              label="Custom expiry (local time)"
              type="datetime-local"
              value={editKeyCustomExpiresAt}
              onChange={(event) => { setEditKeyCustomExpiresAt(event.target.value); setEditKeyStatus(null); }}
            />
          ) : null}
          <Input
            label="Daily token limit"
            type="number"
            min="0"
            step="1"
            value={editKeyDailyLimitTokens}
            onChange={(event) => { setEditKeyDailyLimitTokens(event.target.value); setEditKeyStatus(null); }}
            placeholder="Unlimited (leave empty to clear)"
          />
          {combos.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-dd-muted">Select which combos this key can access. Leave empty to allow all.</p>
              <div tabIndex={0} aria-label="Allowed combos for key" className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-dd-lg border border-dd-border p-2" role="region">
                {combos.map((combo) => (
                  <Checkbox
                    key={combo.id || combo.name}
                    checked={editKeyAllowedCombos.includes(combo.name)}
                    onChange={() => {
                      setEditKeyAllowedCombos((prev) =>
                        prev.includes(combo.name)
                          ? prev.filter((c) => c !== combo.name)
                          : [...prev, combo.name]
                      );
                    }}
                    label={combo.name}
                    hint={combo.kind}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-dd-muted">No combos available.</p>
          )}
          {groups.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Field
                label="Groups"
                hint="Organizational labels only. Groups never change what this key can access."
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {groups.map((group) => {
                    const selected = editKeyGroupIds.includes(group.id);
                    return (
                      <Button
                        key={group.id}
                        size="sm"
                        variant={selected ? "primary" : "secondary"}
                        aria-pressed={selected}
                        onClick={() =>
                          setEditKeyGroupIds((prev) =>
                            prev.includes(group.id)
                              ? prev.filter((id) => id !== group.id)
                              : [...prev, group.id]
                          )
                        }
                      >
                        {group.name}
                      </Button>
                    );
                  })}
                </div>
              </Field>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Field
              label="Provider accounts"
              hint="Restrict this key to a subset of provider accounts. Leave empty for unrestricted access. The zero-relation rule (no rows = unrestricted) is preserved."
            >
              <Select
                value=""
                placeholder="Add provider account"
                options={editKeyProviderOptions}
                onChange={(value) =>
                  value
                    ? setEditKeyProviderConnectionIds((prev) => (prev.includes(value) ? prev : [...prev, value]))
                    : undefined
                }
              />
            </Field>
            <DataTable
              framed={false}
              ariaLabel="Scoped provider accounts for this key"
              columns={[
                { key: "name", label: "Name" },
                { key: "provider", label: "Provider" },
                { key: "id", label: "ID", mono: true },
                {
                  key: "remove",
                  label: "Actions",
                  align: "right",
                  render: (row) => (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setEditKeyProviderConnectionIds((prev) => prev.filter((value) => value !== row.id))
                      }
                    >
                      Remove
                    </Button>
                  ),
                },
              ]}
              rows={editKeyProviderConnectionIds.map((id) => {
                const connection = providerConnections.find((item) => item.id === id) || { id, name: id, provider: "unknown" };
                return { id, name: connection.name || id, provider: connection.provider };
              })}
              keyFn={(row) => row.id}
              density="compact"
              emptyState={{ title: "No scoped accounts", message: "This key can route through every provider account." }}
            />
          </div>
          {isEditableApiKeyPolicy(editKey?.policy) ? (
            <ApiKeyPolicyFields
              draft={editKeyPolicy}
              onChange={(next) => { setEditKeyPolicy(next); setEditKeyPolicyDirty(true); }}
              catalog={policyCatalog}
              loading={policyCatalogLoading}
              usage={editKey?.usage}
            />
          ) : (
            <StatusAlert
              status={{
                type: "error",
                message: "This key has malformed stored policy data. Other key details can be saved safely, but repair or clear the policy through the management API before editing it here.",
              }}
            />
          )}
          {editKeyStatus ? <StatusAlert status={editKeyStatus} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              className="flex-1"
              onClick={async () => {
                if (!editKey) return;
                let expiresAt;
                let policy;
                try {
                  expiresAt = expiryFromSelection(editKeyExpiryPreset, editKeyCustomExpiresAt);
                  policy = apiKeyPolicyPatchFromDraft(editKeyPolicy, editKeyPolicyDirty);
                } catch (error) {
                  setEditKeyStatus({ type: "error", message: error.message });
                  return;
                }
                const parsedLimit = editKeyDailyLimitTokens.trim() === "" ? null : Number(editKeyDailyLimitTokens);
                if (parsedLimit !== null && (!Number.isSafeInteger(parsedLimit) || parsedLimit < 0)) {
                  setEditKeyStatus({ type: "error", message: "Daily limit must be a non-negative whole number" });
                  return;
                }
                const updated = await handleUpdateKeyDetails(editKey.id, editKeyAllowedCombos, expiresAt, policy, parsedLimit, editKeyProviderConnectionIds, editKeyGroupIds);
                if (!updated) return;
                resetEditModal();
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={resetEditModal} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal (pause / delete) */}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        confirmLabel="Confirm"
        tone="danger"
        onConfirm={confirmState?.onConfirm}
        onCancel={() => setConfirmState(null)}
      />

      {/* Group create/rename. PromptDialog, not window.prompt — the Durin DS
          rules forbid native dialogs in ported app code. */}
      <PromptDialog
        open={!!groupPrompt}
        title={groupPrompt?.group ? "Rename group" : "New group"}
        label="Group name"
        placeholder="CI"
        defaultValue={groupPrompt?.group?.name || ""}
        submitLabel={groupPrompt?.group ? "Rename" : "Create"}
        onSubmit={saveGroup}
        onCancel={() => setGroupPrompt(null)}
      />

      <ConfirmDialog
        open={!!groupConfirm}
        title="Delete group"
        message={`Delete "${groupConfirm?.name}"? The keys in it are not deleted — they simply lose this label.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => removeGroup(groupConfirm)}
        onCancel={() => setGroupConfirm(null)}
      />

      {limitsKey && (
        <KeyLimitsModal
          key={limitsKey.id}
          apiKey={limitsKey}
          onClose={() => setLimitsKey(null)}
          onSave={handleSaveLimits}
        />
      )}

      {modelAccessKey && (
        <ApiKeyModelAccessModal
          key={modelAccessKey.id}
          apiKey={modelAccessKey}
          catalog={policyCatalog}
          onClose={() => setModelAccessKey(null)}
          onSave={handleSaveModelAccess}
        />
      )}
    </div>
  );
}
