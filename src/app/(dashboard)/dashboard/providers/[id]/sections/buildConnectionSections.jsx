"use client";

import { dashboardRequest } from "../dashboardRequest";

import { Button, Modal } from "@/shared/components";

import ConnectionRow from "../ConnectionRow";

import NetworkNodeStatus from "../NetworkNodeStatus";

import { getScheduleSlotLabels } from "@/shared/services/quotaPingSchedule";

import { replaceUpdatedConnections } from "@/shared/utils/connectionStatus";

import PersistedTestResult from "../components/PersistedTestResult";

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing"
};

export default function buildConnectionSections({ autoPing, bulkUpdatingProxy, clearingCooldownId, closeBulkProxyModal, codexPlans, connectionFilter, connections, handleApplyOneToOne, handleApplySinglePool, handleAutoPingConnection, handleClearCooldown, handleDelete, handleReconnect, handleSwapPriority, handleUpdateConnectionStatus, isCompatible, isOAuth, isSelected, oneByOneResults, pageConnections, persistedTests, providerId, proxyPools, selectedConnections, setConnections, setScheduleConnection, setSelectedConnection, setSelectedConnectionIds, setShowEditModal, showBulkProxyModal, toggleSelectConnection }) {
  const connectionsList =
  <div role="region" aria-label="Connections" tabIndex={0} className="flex min-w-0 flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03] max-h-[500px] overflow-y-auto pr-1">
      {connections.
    map((conn, index) => ({ conn, index })).filter(({ conn }) => pageConnections.includes(conn)).map(({ conn, index }) =>
    <div key={conn.id} className="flex min-w-0 items-stretch">
            <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center pl-1 sm:pl-2">
              <input
          type="checkbox"
          aria-label={`Select ${conn.name || conn.email || conn.id}`}
          checked={isSelected(conn.id)}
          onChange={() => toggleSelectConnection(conn.id)}
          className="h-4 w-4 rounded border-dd-border text-dd-accent focus:shadow-dd-focus" />
            </label>
            <div className="flex-1 min-w-0">
              <ConnectionRow
                connection={conn}
                providerId={providerId}
                plan={codexPlans[conn.id]}
                proxyPools={proxyPools}
                isOAuth={isOAuth}
                isFirst={connectionFilter.length > 0 || index === 0}
                isLast={connectionFilter.length > 0 || index === connections.length - 1}
                onMoveUp={() => handleSwapPriority(index, index - 1)}
                onMoveDown={() => handleSwapPriority(index, index + 1)}
                onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                onUpdateQuotaLockout={async (quotaLockout) => {
                  const response = await dashboardRequest(`/api/providers/${conn.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotaLockout }) });
                  if (!response.ok) throw new Error("Quota schedule update failed");
                  const data = await response.json();
                  setConnections((previous) => replaceUpdatedConnections(previous, [data.connection]));
                }}
                onClearCooldown={handleClearCooldown}
                clearingCooldown={clearingCooldownId === conn.id}
                autoPing={AUTO_PING_SETTINGS_KEYS[providerId] && conn.authType === "oauth" && conn.isActive !== false ? {
                  on: autoPing.connections[conn.id] === true,
                  onToggle: (on) => handleAutoPingConnection(conn.id, on),
                  provider: providerId,
                  scheduleOn: autoPing.schedules?.[conn.id]?.enabled === true,
                  scheduleSummary: getScheduleSlotLabels(autoPing.schedules?.[conn.id]).join(" / "),
                  onOpenSchedule: () => setScheduleConnection(conn),
                } : null}
                onUpdateProxy={async (proxyPoolId) => {
                  try {
                    const res = await dashboardRequest(`/api/providers/${conn.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                    });
                    if (res.ok) {
                      const { connection: updatedConnection } = await res.json();
                      setConnections(prev => prev.map(c =>
                        c.id === conn.id
                          ? (updatedConnection || c)
                          : c
                      ));
                    }
                  } catch (error) {
                    console.log("Error updating proxy:", error);
                  }
                }}
                onEdit={() => {
                  setSelectedConnection(conn);
                  setShowEditModal(true);
                }}
                onDelete={() => handleDelete(conn.id)}
                onReconnect={() => handleReconnect(conn)}
                oneByOneStatus={oneByOneResults[conn.id] || null}
              />
              {!oneByOneResults[conn.id] && <PersistedTestResult result={persistedTests[conn.id]} />}
              {(isCompatible || providerId === "ollama-local") && (
                <NetworkNodeStatus
                  connection={conn}
                  onRemoved={(removedId) => {
                    setConnections((prev) => prev.filter((c) => c.id !== removedId));
                    setSelectedConnectionIds((prev) => prev.filter((selectedId) => selectedId !== removedId));
                  }}
                />
              )}
            </div>
          </div>
    )}
    </div>;

  const activePools = proxyPools.filter((p) => p.isActive === true);

  const bulkActionModal =
  <Modal
    isOpen={showBulkProxyModal}
    onClose={closeBulkProxyModal}
    title={`Apply Proxy (${selectedConnections.length > 0 ? `${selectedConnections.length} selected` : `all ${connections.length}`} connections)`}>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <button
          onClick={handleApplyOneToOne}
          disabled={bulkUpdatingProxy || activePools.length === 0}
          className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-dd-surface-2 disabled:cursor-not-allowed disabled:opacity-50">

            <span className="material-symbols-outlined text-dd-muted text-[18px]">sync_alt</span>
            <span className="text-sm text-dd-text">One-to-one (rotate)</span>
          </button>
          <button
          onClick={() => handleApplySinglePool(null)}
          disabled={bulkUpdatingProxy}
          className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-dd-surface-2 disabled:cursor-not-allowed disabled:opacity-50">

            <span className="material-symbols-outlined text-dd-muted text-[18px]">link_off</span>
            <span className="text-sm text-dd-text">None (unbind all)</span>
          </button>
          {proxyPools.map((pool) =>
        <button
          key={pool.id}
          onClick={() => handleApplySinglePool(pool.id)}
          disabled={bulkUpdatingProxy || pool.isActive !== true}
          className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-dd-surface-2 disabled:cursor-not-allowed disabled:opacity-50">

              <span className="material-symbols-outlined text-dd-muted text-[18px]">lan</span>
              <span className="truncate text-sm text-dd-text">{pool.name}</span>
              {pool.isActive !== true &&
          <span className="text-[10px] text-dd-muted">(inactive)</span>
          }
            </button>
        )}
        </div>

        {bulkUpdatingProxy && <p className="text-xs text-dd-muted">Applying...</p>}

        <Button onClick={closeBulkProxyModal} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>
          Cancel
        </Button>
      </div>
    </Modal>;

  // Probe one model. Returns the outcome ("ok" | "error" | "skipped"), or null when
  // the page switched provider mid-request and the result no longer applies.

  return { bulkActionModal, connectionsList };
}
