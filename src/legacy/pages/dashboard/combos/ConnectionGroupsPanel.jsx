"use client";

import { useEffect, useMemo, useState } from "react";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import Button from "@/shared/ui/components/Button.jsx";

/**
 * Connection groups panel (issue #747). Mounted directly on the existing
 * `/dashboard/combos` page — organizational grouping of provider
 * connections. Groups never participate in dispatch themselves; a combo's
 * allow-list editor (in `page.js`) expands a group into member ids when the
 * operator picks it. Uses Durin DS `DataTable` + `Pagination`, `Select`,
 * `ConfirmDialog`, `PromptDialog` only — token styling, no raw inputs.
 *
 * @param {object} props
 * @param {object[]} props.connections active provider connections for labels
 */
function connectionLabel(connection) {
  return `${connection.name || connection.email || connection.provider || "Connection"} (${connection.id.slice(0, 8)})`;
}

async function requestJson(url, init) {
  const res = await fetch(url, init);
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(body?.error || "Request failed");
  return body;
}

export default function ConnectionGroupsPanel({ connections = [], onGroupsChange }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [createPromptOpen, setCreatePromptOpen] = useState(false);
  const [groupPendingDelete, setGroupPendingDelete] = useState(null);
  const [assigningGroupId, setAssigningGroupId] = useState("");
  const [error, setError] = useState("");

  const loadGroups = async () => {
    try {
      const data = await requestJson("/api/connection-groups");
      const nextGroups = data.groups || [];
      setGroups(nextGroups);
      onGroupsChange?.(nextGroups);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGroups();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connectionOptions = useMemo(
    () => connections.map((c) => ({ value: c.id, label: connectionLabel(c) })),
    [connections]
  );
  const labelForId = (id) => connectionOptions.find((o) => o.value === id)?.label || id;

  const saveMembership = async (group, connectionIds) => {
    try {
      await requestJson(`/api/connection-groups/${group.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionIds }),
      });
      await loadGroups();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreate = async (name) => {
    try {
      await requestJson("/api/connection-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setCreatePromptOpen(false);
      await loadGroups();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    try {
      await requestJson(`/api/connection-groups/${groupPendingDelete.id}`, { method: "DELETE" });
      setGroupPendingDelete(null);
      await loadGroups();
    } catch (err) {
      setError(err.message);
    }
  };

  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(groups.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleGroups =
    rowsPerPage === "all"
      ? groups
      : groups.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const columns = [
    {
      key: "name",
      label: "Group",
      render: (g) => (
        <div>
          <strong className="text-dd-text">{g.name}</strong>
          {g.description ? <p className="text-xs text-dd-muted">{g.description}</p> : null}
        </div>
      ),
    },
    {
      key: "members",
      label: "Connections",
      render: (g) => (
        <div className="flex flex-wrap gap-1">
          {g.connectionIds.length === 0 ? (
            <span className="text-xs text-dd-subtle">No members</span>
          ) : (
            g.connectionIds.map((id) => (
              <Chip
                key={id}
                size="sm"
                label={labelForId(id)}
                onRemove={() => saveMembership(g, g.connectionIds.filter((x) => x !== id))}
              />
            ))
          )}
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (g) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setAssigningGroupId(g.id)}>
            Assign
          </Button>
          <Button size="sm" variant="danger" onClick={() => setGroupPendingDelete(g)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const assigningGroup = groups.find((g) => g.id === assigningGroupId) || null;
  const unassignedOptions = assigningGroup
    ? connectionOptions.filter((o) => !assigningGroup.connectionIds.includes(o.value))
    : [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-dd-text">Connection groups</h2>
          <p className="text-xs text-dd-muted">
            Groups organize connections for reuse. They never change routing by
            themselves — assign a group to a combo&apos;s allow-list below to enforce it.
          </p>
        </div>
        <Button variant="primary" icon="add" onClick={() => setCreatePromptOpen(true)}>
          Create group
        </Button>
      </div>

      {error ? <p className="text-xs text-dd-danger">{error}</p> : null}

      <DataTable
        columns={columns}
        rows={visibleGroups}
        keyFn={(g) => g.id}
        density="compact"
        loading={loading}
        emptyState={{
          icon: "folder",
          title: "No connection groups yet",
          message: "Create a group, then assign active connections to it.",
        }}
        pagination={{
          page: currentPage,
          pageCount,
          total: groups.length,
          onPage: setPage,
          rowsPerPage,
          onRowsPerPageChange: (value) => {
            setRowsPerPage(value);
            setPage(1);
          },
        }}
      />

      {assigningGroup ? (
        <div className="rounded-dd border border-dd-border bg-dd-surface p-3">
          <p className="mb-2 text-xs font-medium text-dd-muted">
            Assign a connection to &ldquo;{assigningGroup.name}&rdquo;
          </p>
          <div className="flex gap-2">
            <Select
              options={unassignedOptions}
              value=""
              onChange={async (id) => {
                await saveMembership(assigningGroup, [...assigningGroup.connectionIds, id]);
              }}
              placeholder={unassignedOptions.length ? "Select a connection" : "All connections assigned"}
              disabled={unassignedOptions.length === 0}
            />
            <Button variant="ghost" onClick={() => setAssigningGroupId("")}>
              Close
            </Button>
          </div>
        </div>
      ) : null}

      <PromptDialog
        open={createPromptOpen}
        title="Create connection group"
        label="Group name"
        placeholder="Production accounts"
        submitLabel="Create"
        onCancel={() => setCreatePromptOpen(false)}
        onSubmit={handleCreate}
      />

      <ConfirmDialog
        open={!!groupPendingDelete}
        title="Delete connection group"
        message={`Delete "${groupPendingDelete?.name}"? Its connections stay active and simply become ungrouped.`}
        confirmLabel="Delete"
        onCancel={() => setGroupPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </section>
  );
}
