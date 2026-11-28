"use client";

import { Card, CardHeader } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";
import { getCodexPlan } from "@/shared/utils/codexPlanLabel";
import QuotaTable from "./QuotaTable";
import QuotaThresholds from "./QuotaThresholds";
import { mergeAccountQuotas } from "./grouping";
import { getQuotaVisibilityKey, getConnectionLabel } from "./utils";
import {
  AUTO_PING_SETTINGS_KEYS,
  AUTO_PING_TOOLTIPS,
  kiroMethodLabel,
  getConnectionSecondaryLabel,
  kiroRegion,
  getCodexResetCreditCount,
  formatClaudeResetClears,
  formatCreditDate } from
"./connectionDisplay";

/** One provider card: reorder controls, merged view toggle and a section per account. */
export default function ProviderGroupCard({
  group,
  autoPingMaps,
  connectionQuotaRows,
  copied,
  copy,
  deletingId,
  draggedProvider,
  errors,
  fetchConnections,
  handleHideQuota,
  handleRefreshToken,
  handleShowQuota,
  handleToggleConnectionActive,
  handleUltrafast,
  handleViewClaudeResets,
  handleViewCodexResetCredits,
  keyboardProvider,
  loading,
  mergedProviders,
  moveProvider,
  nodeLabels,
  orderPending,
  providerOrder,
  quotaData,
  quotaSortMode,
  refreshProvider,
  refreshingTokenId,
  resettingLimitId,
  setDeleteConfirmState,
  setKeyboardProvider,
  setResetConfirmState,
  setSelectedConnection,
  setShowEditModal,
  toggleAutoPing,
  toggleMergedView,
  togglingId,
  uiV5
}) {
  const isGrouped = group.connections.length > 1;
  // Connections can share a team's prepaid balance. Keep credit rows
  // per account, including zero balances and saved merged preferences.
  // Rolling spend rows have no window to add up, so they stay separate too.
  const canMerge = isGrouped && !group.connections.some((conn) =>
    (quotaData[conn.id]?.quotas || []).some((quota) => quota.isCreditBalance === true || quota.isSpend === true)
  );
  const isMerged = canMerge && mergedProviders[group.provider] === true;
  const isCodexGroup = group.provider === "codex";

  const renderAccountSection = (conn, sectionIndex) => {
    const quota = quotaData[conn.id];
    const isLoading = loading[conn.id];
    const error = errors[conn.id];
    const isInactive = conn.isActive === false;
    const isCodex = conn.provider === "codex";
    const isClaude = conn.provider === "claude";
    const codexPlan = isCodex ? getCodexPlan(quota, conn) : "";
    const claudeReset = isClaude ? quota?.raw?.resetCredits : null;
    const resetLabel = isCodex ? "Codex reset credit" : "Claude limit reset";
    const resetCreditCount = getCodexResetCreditCount(quota);
    const isResettingLimit = resettingLimitId === conn.id;
    const rowBusy = deletingId === conn.id || togglingId === conn.id || isResettingLimit || refreshingTokenId === conn.id;
    const { visibleQuotas, hiddenQuotaRows } = connectionQuotaRows[conn.id] || { visibleQuotas: [], hiddenQuotaRows: [] };
    const testStatus = isInactive ? "disabled" : conn.testStatus || "unknown";
    const testStatusTone = isInactive ? "neutral" : conn.testStatus === "active" || conn.testStatus === "success" ? "success" : conn.testStatus === "error" || conn.testStatus === "expired" || conn.testStatus === "unavailable" ? "danger" : "neutral";
    const secondaryLabel = getConnectionSecondaryLabel(conn);

    return <section key={conn.id} aria-label={secondaryLabel ? `${getConnectionLabel(conn)} · ${secondaryLabel}` : getConnectionLabel(conn) || conn.id} className={[sectionIndex > 0 ? "border-t border-dd-border-subtle" : "", isInactive ? "opacity-60" : "", "flex flex-col gap-3 p-3"].filter(Boolean).join(" ")}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 sm:basis-0">
          <span className="truncate text-[13px] font-medium text-dd-text">{getConnectionLabel(conn)}</span>
          {secondaryLabel ? <span className="truncate text-xs text-dd-muted">{secondaryLabel}</span> : null}
        </span>
        <span className="flex min-w-0 max-w-full w-full flex-wrap items-center gap-1.5 sm:w-auto">
          {conn.quotaPaused && !isInactive ? <Badge tone="warning" size="sm">Paused (quota)</Badge> : null}
          {isCodex && codexPlan ? <Badge tone="accent" size="sm" className="capitalize">{codexPlan}</Badge> : null}
          {isCodex || claudeReset ? <>
            <Tooltip content={resetCreditCount > 0 ? claudeReset ? `Use your reset now (${resetCreditCount} left, use by ${formatCreditDate(claudeReset.expiresAt)}) · refills ${formatClaudeResetClears(claudeReset.clears)}` : `Use one ${resetLabel}. Available: ${resetCreditCount}` : `No ${resetLabel}s available`}><Button variant="secondary" size="sm" icon={isResettingLimit ? "progress_activity" : "restart_alt"} onClick={() => setResetConfirmState({ connection: conn, resetCreditCount, grantId: claudeReset?.nextGrantId })} disabled={resetCreditCount <= 0 || isLoading || rowBusy} className={isResettingLimit ? "[&_span]:animate-spin dd-tnum" : "dd-tnum"} aria-label={resetCreditCount > 0 ? `Use one ${resetLabel}. ${resetCreditCount} available.` : `No ${resetLabel}s available`}>{resetCreditCount}</Button></Tooltip>
            <Tooltip content={isCodex ? "View Codex reset credit expiry" : "View Claude Code reset expiry"}><IconButton label={isCodex ? "View Codex reset credit expiry" : "View Claude Code reset expiry"} icon="schedule" onClick={() => isCodex ? handleViewCodexResetCredits(conn) : handleViewClaudeResets(conn, claudeReset)} disabled={isLoading || rowBusy} /></Tooltip>
          </> : null}
          {AUTO_PING_SETTINGS_KEYS[conn.provider] && conn.authType === "oauth" && !isInactive ? <Tooltip content={AUTO_PING_TOOLTIPS[conn.provider]}><IconButton label="Toggle auto-ping" icon="bolt" onClick={() => toggleAutoPing(conn.id, conn.provider, autoPingMaps[conn.provider]?.[conn.id] !== true)} className={autoPingMaps[conn.provider]?.[conn.id] === true ? "text-dd-accent" : ""} /></Tooltip> : null}
          {isCodex ? <Tooltip content="Ultrafast applies to GPT 6.2 Sol and uses 6× included usage"><Button variant="secondary" size="sm" disabled={rowBusy} aria-pressed={conn.providerSpecificData?.codexUltrafastMode === true} onClick={() => handleUltrafast(conn)}>Ultrafast {conn.providerSpecificData?.codexUltrafastMode === true ? "on" : "off"}</Button></Tooltip> : null}
          {isCodex && conn.authType === "oauth" ? <Button variant="secondary" size="sm" disabled={rowBusy} onClick={() => handleRefreshToken(conn)}>{refreshingTokenId === conn.id ? "Refreshing credential…" : "Refresh credential"}</Button> : null}
          <Tooltip content="Refresh (bypass cache)"><IconButton label="Refresh quota" title="Refresh (bypass cache)" icon={isLoading ? "progress_activity" : "refresh"} onClick={() => refreshProvider(conn.id, conn.provider)} disabled={isLoading || rowBusy} className={isLoading ? "[&_span]:animate-spin" : ""} /></Tooltip>
          <Tooltip content="Edit connection"><IconButton label="Edit connection" icon="edit" onClick={() => { setSelectedConnection(conn); setShowEditModal(true); }} disabled={rowBusy} /></Tooltip>
          <Tooltip content="Delete connection"><IconButton label="Delete connection" icon="delete" onClick={() => setDeleteConfirmState(conn)} disabled={rowBusy} className="text-dd-danger hover:text-dd-danger" /></Tooltip>
          <Toggle checked={conn.isActive ?? true} disabled={rowBusy} aria-label={conn.isActive ?? true ? "Disable connection" : "Enable connection"} onChange={(nextActive) => handleToggleConnectionActive(conn.id, nextActive)} />
        </span>
      </div>
      {conn.provider === "kiro" ? <div className="flex flex-wrap items-center gap-1"><Badge tone="accent" size="sm">{kiroMethodLabel(conn)}</Badge>{kiroRegion(conn) ? <Badge tone="info" size="sm">{kiroRegion(conn)}</Badge> : null}<Badge tone={testStatusTone} size="sm">{testStatus}</Badge>{conn.providerSpecificData?.profileArn ? <Button variant="ghost" size="sm" icon={copied === conn.id ? "check" : "content_copy"} onClick={() => copy(conn.providerSpecificData.profileArn, conn.id)} title={conn.providerSpecificData.profileArn} className="max-w-full justify-start px-2 font-mono text-[11px]"><span className="truncate">{conn.providerSpecificData.profileArn}</span></Button> : null}</div> : null}
      <QuotaThresholds connection={conn} onSaved={fetchConnections} />
      {conn.provider === "github" && quota?.raw?.rateLimit ? <div className="rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-3 py-2 text-xs" role="status">Last GitHub rate limit: {quota.raw.rateLimit.remaining ?? "?"} / {quota.raw.rateLimit.limit ?? "?"} remaining{quota.raw.rateLimit.resetAt ? ` · resets ${new Date(quota.raw.rateLimit.resetAt).toLocaleString()}` : ""}</div> : null}
      {isLoading ? <div className="flex justify-center py-5 text-dd-muted"><span role="status" aria-label="Loading quota" className="material-symbols-outlined animate-spin text-[28px]">progress_activity</span></div> : error ? <div role="alert" className="rounded-dd border border-dd-danger bg-dd-danger/10 p-3 text-[13px] text-dd-danger">{error}{uiV5 ? <Button variant="secondary" size="sm" icon="refresh" className="ms-2" onClick={() => refreshProvider(conn.id, conn.provider)} disabled={rowBusy}>Retry quota</Button> : null}</div> : quota?.message ? <div className="rounded-dd border border-dd-info bg-dd-info/10 p-3 text-[13px] text-dd-info">{quota.message}</div> : <>
        {/* Stale rows still beat no rows, but the reason must be visible
            so nobody mistakes cached numbers for live ones. */}
        {quota?.staleReason ? <div className="rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-3 py-2 text-xs text-dd-warning">{quota.staleReason}</div> : null}
        {quota?.notice ? <div className="rounded-dd border border-dd-info bg-dd-info/10 p-3 text-[13px] text-dd-info">{quota.notice}</div> : null}
        <QuotaTable quotas={visibleQuotas} compact sortMode={isCodex ? quotaSortMode : "default"} showSortLabel={isCodex && quotaSortMode !== "default"} onHideQuota={(quotaRow) => handleHideQuota(conn.id, conn.provider, quotaRow)} />
      </>}
      {hiddenQuotaRows.length > 0 ? <div className="flex flex-wrap items-center gap-1 border-t border-dd-border-subtle pt-2 text-xs text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined text-[14px]">visibility_off</span><span>Hidden:</span>{hiddenQuotaRows.map((quotaRow) => <Button key={getQuotaVisibilityKey(quotaRow, quotaRow.visibilityIndex)} variant="secondary" size="sm" onClick={() => handleShowQuota(conn.id, conn.provider, quotaRow)} title="Show this quota row">{quotaRow.name}</Button>)}</div> : null}
    </section>;
  };

  const mergedQuotas = isMerged ?
  mergeAccountQuotas(group.connections.map((conn) => ({
    connectionId: conn.id,
    quotas: (connectionQuotaRows[conn.id]?.visibleQuotas || []).filter((quota) => !quota.notReported)
  }))) :
  [];
  const anyAccountLoading = group.connections.some((conn) => loading[conn.id]);

  return <Card padding={false} className="min-w-0"
    onDragOver={(event) => { if (draggedProvider.current) event.preventDefault(); }}
    onDrop={(event) => { event.preventDefault(); const source = draggedProvider.current; draggedProvider.current = null; if (source) void moveProvider(source, group.provider); }}>
    <div className="flex items-center gap-1 px-3 pt-2">
      <button type="button" draggable={!orderPending} disabled={orderPending} aria-label={`Drag ${group.provider} to reorder`} title="Drag to reorder, or press Space then arrow keys" onDragStart={() => { draggedProvider.current = group.provider; }} onDragEnd={() => { draggedProvider.current = null; }} aria-pressed={keyboardProvider === group.provider} onClick={() => setKeyboardProvider((current) => current === group.provider ? null : group.provider)} onKeyDown={(event) => {
        if (event.key === "Escape") { setKeyboardProvider(null); return; }
        if (keyboardProvider !== group.provider || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const offset = event.key === "ArrowUp" ? -1 : 1;
        void moveProvider(group.provider, providerOrder[providerOrder.indexOf(group.provider) + offset]);
      }} className="cursor-grab text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined">drag_indicator</span></button>
      <button type="button" disabled={orderPending || providerOrder.indexOf(group.provider) <= 0} onClick={() => void moveProvider(group.provider, providerOrder[providerOrder.indexOf(group.provider) - 1])} aria-label={`Move ${group.provider} earlier`} className="text-dd-muted disabled:opacity-40">↑</button>
      <button type="button" disabled={orderPending || providerOrder.indexOf(group.provider) < 0 || providerOrder.indexOf(group.provider) === providerOrder.length - 1} onClick={() => void moveProvider(group.provider, providerOrder[providerOrder.indexOf(group.provider) + 1])} aria-label={`Move ${group.provider} later`} className="text-dd-muted disabled:opacity-40">↓</button>
    </div>
    <CardHeader
      title={<span className="inline-flex min-w-0 items-center gap-2"><ProviderLogo provider={group.provider} size={32} /><span className={nodeLabels[group.provider] ? "truncate" : "truncate capitalize"}>{nodeLabels[group.provider] || group.provider}</span></span>}
      subtitle={isGrouped ? `${group.connections.length} accounts` : null}
      actions={canMerge ? <Tooltip content="Merge identical quotas across accounts"><span className="flex items-center gap-1.5 text-xs text-dd-muted">Merged<Toggle size="sm" checked={isMerged} aria-label={`Merge ${group.provider} quotas across accounts`} onChange={(nextMerged) => toggleMergedView(group.provider, nextMerged)} /></span></Tooltip> : null}
    />
    <div className="flex flex-col">
      {isMerged ? <div className="flex flex-col gap-3 p-3">
        {group.connections.map((conn) => {
          const error = errors[conn.id];
          const message = quotaData[conn.id]?.message || quotaData[conn.id]?.notice;
          const accountLabel = getConnectionLabel(conn);
          const { hiddenQuotaRows } = connectionQuotaRows[conn.id] || { hiddenQuotaRows: [] };
          return <div key={conn.id} className="flex flex-col gap-2">
            <QuotaThresholds connection={conn} onSaved={fetchConnections} />
      {conn.provider === "github" && quota?.raw?.rateLimit ? <div className="rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-3 py-2 text-xs" role="status">Last GitHub rate limit: {quota.raw.rateLimit.remaining ?? "?"} / {quota.raw.rateLimit.limit ?? "?"} remaining{quota.raw.rateLimit.resetAt ? ` · resets ${new Date(quota.raw.rateLimit.resetAt).toLocaleString()}` : ""}</div> : null}
            {conn.quotaPaused ? <Badge tone="warning" size="sm">Paused (quota)</Badge> : null}
            {error ? <div role="alert" className="rounded-dd border border-dd-danger bg-dd-danger/10 p-3 text-[13px] text-dd-danger"><span className="font-medium">{accountLabel}:</span> {error}</div> : message ? <div className="rounded-dd border border-dd-info bg-dd-info/10 p-3 text-[13px] text-dd-info"><span className="font-medium">{accountLabel}:</span> {message}</div> : null}
            {hiddenQuotaRows.length > 0 ? <div className="flex flex-wrap items-center gap-1 text-xs text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined text-[14px]">visibility_off</span><span>Hidden ({accountLabel}):</span>{hiddenQuotaRows.map((quotaRow) => <Button key={getQuotaVisibilityKey(quotaRow, quotaRow.visibilityIndex)} variant="secondary" size="sm" onClick={() => handleShowQuota(conn.id, conn.provider, quotaRow)} title="Show this quota row">{quotaRow.name}</Button>)}</div> : null}
          </div>;
        })}
        {anyAccountLoading && mergedQuotas.length === 0 ? <div className="flex justify-center py-5 text-dd-muted"><span role="status" aria-label="Loading quota" className="material-symbols-outlined animate-spin text-[28px]">progress_activity</span></div> : null}
        {mergedQuotas.length > 0 ? <QuotaTable quotas={mergedQuotas} compact sortMode={isCodexGroup ? quotaSortMode : "default"} showSortLabel={isCodexGroup && quotaSortMode !== "default"} /> : null}
      </div> : group.connections.map((conn, sectionIndex) => renderAccountSection(conn, sectionIndex))}
    </div>
  </Card>;
}
