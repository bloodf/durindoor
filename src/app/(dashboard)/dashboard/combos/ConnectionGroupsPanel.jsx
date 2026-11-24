"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import api from "@/shared/utils/api.js";

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

// Keep the client's coerced HTTP message when the body supplies an error.
const strictJson = { strictJson: true };
async function withPanelError(request) {
  try {
    return await request();
  } catch (error) {
    if (error?.status !== undefined && !error.body?.error) error.message = "Request failed";
    throw error;
  }
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

  const errorVersion = useRef(0);
  const reportError = useCallback((message) => {
    errorVersion.current += 1;
    setError(message);
  }, []);

  /** Initial reads stop on unmount; versioning protects newer mutation errors from stale refreshes. */
  const loadGroups = useCallback((signal) => {
    const startedErrorVersion = errorVersion.current;
    return withPanelError(() => api.get("/api/connection-groups", { ...strictJson, signal })).then((data) => {
      if (signal?.aborted) return;
      const nextGroups = data.groups || [];
      /** A successful refresh clears feedback only when no newer mutation failure was reported. */
      if (errorVersion.current === startedErrorVersion) setError("");
      setGroups(nextGroups);
      onGroupsChange?.(nextGroups);
    }).catch((err) => {
      if (!signal?.aborted) reportError(err.message);
    }).finally(() => {
      if (!signal?.aborted) setLoading(false);
    });
  }, [onGroupsChange, reportError]);

  useEffect(() => {
    const controller = new AbortController();
    loadGroups(controller.signal);
    return () => controller.abort();
  }, [loadGroups]);

  const connectionOptions = useMemo(
    () => connections.map((c) => ({ value: c.id, label: connectionLabel(c) })),
    [connections]
  );
  const labelForId = (id) => connectionOptions.find((o) => o.value === id)?.label || id;

  const saveMembership = async (group, connectionIds) => {
    try {
      await withPanelError(() => api.put(`/api/connection-groups/${group.id}`, { connectionIds }, strictJson));
      await loadGroups();
    } catch (err) {
      reportError(err.message);
    }
  };

  const handleCreate = async (name) => {
    try {
      await withPanelError(() => api.post("/api/connection-groups", { name }, strictJson));
      setCreatePromptOpen(false);
      await loadGroups();
    } catch (err) {
      reportError(err.message);
    }
  };

  const handleDelete = async () => {
    try {
      await withPanelError(() => api.del(`/api/connection-groups/${groupPendingDelete.id}`, strictJson));
      setGroupPendingDelete(null);
      await loadGroups();
    } catch (err) {
      reportError(err.message);
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

      {error ? <p role="alert" className="text-xs text-dd-danger">{error}</p> : null}

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
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              aria-label={`Assign connection to ${assigningGroup.name}`}
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
