"use client";

import { dashboardRequest } from "../dashboardRequest";

import FireflyBrowserPanel from "../FireflyBrowserPanel.jsx";
import OpenRouterRoutingCard from "../OpenRouterRoutingCard";

import ProviderRpmControl from "../ProviderRpmControl.jsx";

import Link from "next/link";
import { Card, Button, Input, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, XiaomiMimoAuthModal, ImportTokenModal, IFlowCookieModal, GitLabAuthModal, GheCopilotAuthModal, CopilotM365AuthModal, Toggle, EditConnectionModal, NoAuthProxyCard, ConfirmModal, ProviderIcon, OrcaRouterAuthModal, OrcaModelDropdown } from "@/shared/components";
import Select from "@/shared/ui/components/Select.jsx";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import { DEFAULT_PROVIDER_RPM, MAX_PROVIDER_RPM } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";

import { translate } from "@/i18n/runtime";

import NativeProviderReadiness from "../NativeProviderReadiness.jsx";

import VisibleModelsModal from "../VisibleModelsModal";
import ModelAutoSyncPanel from "../ModelAutoSyncPanel";
import SyncProviderModelsModal from "../SyncProviderModelsModal.jsx";

import AddApiKeyModal from "../AddApiKeyModal";
import CookieImportModal from "../CookieImportModal";

import EditCompatibleNodeModal from "../EditCompatibleNodeModal";
import ProviderErrorRulesModal from "../ProviderErrorRulesModal";
import AutoPingScheduleModal from "../AutoPingScheduleModal";

import AddCustomModelModal from "../AddCustomModelModal";
import BulkImportCodexModal from "../BulkImportCodexModal";
import BulkImportGrokCliModal from "../BulkImportGrokCliModal";

import { buildTimelineHref } from "../../../timeline/href.js";

import BulkReviewModal from "../components/BulkReviewModal";

import { isString } from "../../../../../../shared/utils/typeChecks.js";

const RETRY_DELAY_OPTIONS = [
["auto", "Retry: Auto"],
["15", "Retry: 15s"],
["30", "Retry: 30s"],
["60", "Retry: 1m"],
["120", "Retry: 2m"],
["300", "Retry: 5m"],
["600", "Retry: 10m"],
["1800", "Retry: 30m"],
["3600", "Retry: 1h"]];

import buildConnectionSections from "./buildConnectionSections.jsx";

import buildModelsSection from "./buildModelsSection.jsx";

export default function ProviderDetailSections({ addConnectionError, allSelected, apiKeyConnectionLabel, apiKeyModalAuthType, autoPing, bulkFailures, bulkReview, bulkStatusAction, bulkTestingModels, bulkUpdatingProxy, cancelBulkReview, catalogEvidence, chutesCatalog, clearingCooldownId, closeBulkProxyModal, codexPlans, concurrencyLimit, confirmBulkReview, confirmState, connectionFilter, connectionPageSize, connections, cookieImportContract, copied, copy, currentProviderIdRef, customModels, devinDesktopBrowserSignIn, disabledModelIds, editingCustomModel, egressBucketed, enabledModelIds, errorRules, fetchAliases, fetchConnections, fetchCustomModels, fetchDisabledModels, getCaps, handleAddCustomModel, handleAgRiskConfirm, handleApplyOneToOne, handleApplySinglePool, handleAutoPingConnection, handleCacheAffinityToggle, handleClearCooldown, handleConcurrencyLimitChange, handleDelete, handleDeleteAlias, handleDeleteCustomModel, handleDisableAll, handleDisableFailedModels, handleDisableModel, handleEarliestResetToggle, handleEgressBucketedChange, handleEnableAll, handleEnableModel, handleIFlowCookieSuccess, handleImportQoderModels, handleImportTokenSubmit, handleOAuthSuccess, handleReconnect, handleReorderByStatus, handleRetryDelayChange, handleRoundRobinToggle, handleRunOneByOneTest, handleSaveApiKey, handleSaveAutoPingSchedule, handleSetAlias, handleStickyLimitChange, handleStopOneByOneTest, handleSwapPriority, handleSyncModels, handleTestModel, handleThinkingModeChange, handleUpdateConnection, handleUpdateConnectionStatus, handleUpdateCustomModel, handleUpdateNode, hasDualAuthModes, hiddenTestResultCount, importTokenError, importTokenValue, importingQoderModels, importingToken, isAnthropicCompatible, isCompatible, isDevinAgentic, isFreeNoAuth, isImportToken, isOAuth, isSelected, isStoredNoAuth, kiloFreeModels, loading, modelAliases, modelBulkBusy, modelFilter, modelGroup, modelOperator, modelSort, modelTestResults, models, modelsFetchedAt, modelsTestError, modelsTestMessage, oauthConnectionLabel, oneByOneCurrentConnectionId, oneByOneResults, oneByOneRunning, oneByOneStopping, oneByOneSummary, page, pageConnections, pageCount, persistedTests, profileRefreshStatus, providerApiKeyConnectionNames, providerDisplayAlias, providerGenerationRef, providerId, providerInfo, providerNode, providerStickyLimit, providerStorageAlias, providerStrategy, providerThinkingLevels, proxyPools, proxyPoolsReady, reconnectConnectionId, refreshingProfiles, requestBulkDeleteReview, requestBulkStatusReview, resolveThinkingSuffix, retryDelay, router, rpmLimit, saveErrorRules, saveRpmLimit, scheduleConnection, selectedActiveCount, selectedConnection, selectedConnectionIds, selectedConnections, selectedInactiveCount, selectedModels, selectedOrcaModel, setAddConnectionError, setApiKeyModalAuthType, setConfirmState, setConnectionFilter, setConnectionPageNumber, setConnectionPageSize, setConnections, setDevinDesktopBrowserSignIn, setEditingCustomModel, setEnabledModelIds, setImportTokenError, setImportTokenValue, setModelBulkBusy, setModelFilter, setModelGroup, setModelOperator, setModelSort, setModelsTestError, setModelsTestMessage, setProfileRefreshStatus, setReconnectConnectionId, setRefreshingProfiles, setRpmLimit, setScheduleConnection, setSelectedConnection, setSelectedConnectionIds, setSelectedModels, setSelectedOrcaModel, setShowAddApiKeyModal, setShowAddCustomModel, setShowAgRiskModal, setShowBulkImportCodex, setShowBulkImportGrokCli, setShowBulkProxyModal, setShowCookieImportModal, setShowEditModal, setShowEditNodeModal, setShowErrorRulesModal, setShowIFlowCookieModal, setShowImportTokenModal, setShowM365SignInModal, setShowOAuthModal, setShowSyncProviderModels, setShowVisibleModels, setSyncedModels, showAddApiKeyModal, showAddCustomModel, showAgRiskModal, showBulkImportCodex, showBulkImportGrokCli, showBulkProxyModal, showConnections, showCookieImportModal, showEditModal, showEditNodeModal, showErrorRulesModal, showIFlowCookieModal, showImportTokenModal, showM365SignInModal, showOAuthModal, showSyncProviderModels, showVisibleModels, suggestedModels, supportsApiKeyAuth, supportsAuthTokenAuth, syncingModels, testingModelIds, thinkingMode, toggleSelectAllConnections, toggleSelectConnection, triggerAddConnection, triggerApiKeyConnection, triggerOAuthConnection, uiV5, visibleConnections }) {
  // OpenAI-compatible nodes allow multiple API keys for the same base URL (upstream #1781);
  // Anthropic-compatible nodes stay single-connection in the provider detail UI.
  const canAddConnectionAfterFirst = !isCompatible || !isAnthropicCompatible;
  const { bulkActionModal, connectionsList } = buildConnectionSections({ autoPing, bulkUpdatingProxy, clearingCooldownId, closeBulkProxyModal, codexPlans, connectionFilter, connections, handleApplyOneToOne, handleApplySinglePool, handleAutoPingConnection, handleClearCooldown, handleDelete, handleReconnect, handleSwapPriority, handleUpdateConnectionStatus, isCompatible, isOAuth, isSelected, oneByOneResults, pageConnections, persistedTests, providerId, proxyPools, selectedConnections, setConnections, setScheduleConnection, setSelectedConnection, setSelectedConnectionIds, setShowEditModal, showBulkProxyModal, toggleSelectConnection });

  const { renderModelsSection } = buildModelsSection({ catalogEvidence, chutesCatalog, connections, copied, copy, customModels, disabledModelIds, fetchAliases, fetchCustomModels, fetchDisabledModels, getCaps, handleAddCustomModel, handleDeleteAlias, handleDeleteCustomModel, handleDisableModel, handleEnableModel, handleImportQoderModels, handleSetAlias, handleSyncModels, handleTestModel, importingQoderModels, isAnthropicCompatible, isCompatible, isDevinAgentic, isFreeNoAuth, kiloFreeModels, modelAliases, modelBulkBusy, modelFilter, modelGroup, modelOperator, modelSort, modelTestResults, models, modelsFetchedAt, providerDisplayAlias, providerGenerationRef, providerId, providerStorageAlias, resolveThinkingSuffix, selectedModels, setConfirmState, setEditingCustomModel, setModelBulkBusy, setModelFilter, setModelGroup, setModelOperator, setModelSort, setModelsTestError, setModelsTestMessage, setSelectedModels, setShowAddCustomModel, setShowSyncProviderModels, suggestedModels, syncingModels, testingModelIds });

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>);

  }

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-dd-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="text-dd-accent mt-4 inline-block">
          Back to Providers
        </Link>
      </div>);

  }

  if (providerId === "adobe-firefly-web") return <FireflyBrowserPanel />;

  const autoSyncPanel = !isCompatible ? (
    <ModelAutoSyncPanel
      key={providerId}
      providerId={providerId}
      hasConnection={connections.some((conn) => conn.isActive !== false)}
      onModelsChange={setSyncedModels}
    />
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:gap-8 sm:px-0">
      {/* Header */}
      <div className="min-w-0">
        <Link
          href="/dashboard/providers"
          className="inline-flex min-h-11 items-center gap-1 rounded-dd px-2 text-sm text-dd-muted outline-none hover:text-dd-accent focus-visible:shadow-dd-focus transition-colors mb-4">
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to Providers
        </Link>
        <Link
          href={buildTimelineHref({ provider: providerId })}
          className="inline-flex min-h-11 items-center gap-1 rounded-dd px-2 text-sm text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus mb-4 ml-4"
        >
          View all
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-dd-lg bg-dd-surface-2">
            {/* Configured URLs take precedence; compatible nodes otherwise try their own asset before the generic icon. */}
            {providerInfo.iconUrl ? (
              <ProviderIcon
                src={providerInfo.iconUrl}
                alt={providerInfo.name}
                size={48}
                className="max-h-12 max-w-12 rounded-dd object-contain"
                fallbackText={providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              />
            ) : isCompatible ? (
              <ProviderIcon
                src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/providers/${providerId}.png`}
                fallbackSrc={isAnthropicCompatible ? "/providers/anthropic-m.png" : providerInfo.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png"}
                alt={providerInfo.name}
                size={48}
                className="max-h-12 max-w-12 rounded-dd object-contain"
                fallbackText={providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              />
            ) : (
              <ProviderLogo provider={providerId} size={48} />
            )}
          </div>
          <div className="min-w-0 flex-1 basis-48">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{providerInfo.name}</h1>
              {(providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website) &&
              <a
                href={providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 rounded-dd px-2 text-xs text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus">

                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  {providerInfo.notice?.apiKeyUrl ? "Get API Key" : "Sign up / Learn more"}
                </a>
              }
            </div>
            <p className="text-dd-muted">
              {connections.length} connection{connections.length === 1 ? "" : "s"}
            </p>
          </div>
          {/* Keep controls below the identity when a row cannot fit both. */}
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
            <ProviderRpmControl value={rpmLimit} placeholder={String(DEFAULT_PROVIDER_RPM[providerId] || 0)} max={MAX_PROVIDER_RPM} onChange={setRpmLimit} onSave={saveRpmLimit} />
            <span className="hidden text-xs text-dd-muted sm:inline">Retry delay</span>
            <div className="w-44"><Select options={RETRY_DELAY_OPTIONS.map(([value, label]) => ({ value, label }))} value={retryDelay} onChange={(value) => handleRetryDelayChange(value)} title="Static cooldown when the provider reports no reset deadline" size="sm" aria-label="Retry delay" /></div>
          </div>
        </div>
      </div>

      {providerInfo.deprecated &&
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dd-warning/10 border border-dd-warning/30">
          <span className="material-symbols-outlined text-[16px] text-dd-warning mt-0.5 shrink-0">warning</span>
          <p className="text-xs text-dd-danger dark:text-dd-warning leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      }

      {providerInfo.notice?.text && !providerInfo.deprecated &&
      <div className="flex flex-col gap-2 rounded-lg border border-dd-info/30 bg-dd-info/10 px-3 py-2 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-[16px] text-dd-info shrink-0">info</span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-dd-info">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl &&
        <a
          href={providerInfo.notice.apiKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex justify-center rounded bg-dd-info px-2 py-1 text-xs font-medium text-dd-on-accent transition-colors hover:bg-dd-info sm:py-0.5">

              Get API Key →
            </a>
        }
        </div>
      }

      <NativeProviderReadiness providerId={providerId} connections={connections} />

      {providerId === "openrouter" && <OpenRouterRoutingCard providerId={providerId} />}
      {isCompatible && providerNode &&
      <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
              <p className="break-all text-sm text-dd-muted">
                {isAnthropicCompatible ? "Messages API" : providerNode.apiType === "responses" ? "Responses API" : "Chat Completions"} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : providerNode.apiType === "responses" ? "responses" : "chat/completions"}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button
              size="sm"
              icon="add"
              onClick={() => {
                setAddConnectionError("");
                setShowAddApiKeyModal(true);
              }}
              className="w-full sm:w-auto">

                Add API Key
              </Button>
              <Button
              size="sm"
              variant="secondary"
              icon="edit"
              onClick={() => setShowEditNodeModal(true)}
              className="w-full sm:w-auto">

                Edit
              </Button>
              <Button
              size="sm"
              variant="secondary"
              icon="delete"
              onClick={async () => {
                setConfirmState({
                  title: "Delete Compatible Node",
                  message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
                  onConfirm: async () => {
                    setConfirmState(null);
                    try {
                      const res = await dashboardRequest(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                      if (res.ok) {
                        router.push("/dashboard/providers");
                      }
                    } catch (error) {
                      console.log("Error deleting provider node:", error);
                    }
                  }
                });
              }}
              className="w-full sm:w-auto">

                Delete
              </Button>
            </div>
          </div>
        </Card>
      }

      {/* Connections */}
      {isFreeNoAuth && !isStoredNoAuth &&
      <NoAuthProxyCard providerId={providerId} />
      }
      {showConnections &&
      <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Connections</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              {!isDevinAgentic && connections.length > 0 && proxyPools.length > 0 &&
            <Button
              size="sm"
              variant="secondary"
              icon="lan"
              onClick={() => setShowBulkProxyModal(true)}>

                  Apply Proxy
                </Button>
            }
              {connections.length > 0 &&
            <>
                  {selectedConnectionIds.length > 0 &&
              <>
                      <Button
                  size="sm"
                  variant="secondary"
                  icon="check_circle"
                  onClick={() => requestBulkStatusReview(true)}
                  disabled={bulkStatusAction !== null || selectedInactiveCount === 0}>

                        {bulkStatusAction === "on" ? "Turning On..." : `On Selected (${selectedConnectionIds.length})`}
                      </Button>
                      <Button
                  size="sm"
                  variant="secondary"
                  icon="block"
                  onClick={() => requestBulkStatusReview(false)}
                  disabled={bulkStatusAction !== null || selectedActiveCount === 0}>

                        {bulkStatusAction === "off" ? "Turning Off..." : `Off Selected (${selectedConnectionIds.length})`}
                      </Button>
                      <Button size="sm" variant="secondary" icon="sync" onClick={() => handleRunOneByOneTest(selectedConnections)} disabled={oneByOneRunning}>
                        Test Selected ({selectedConnectionIds.length})
                      </Button>
                      <Button
                  size="sm"
                  variant="danger"
                  icon="delete"
                  onClick={requestBulkDeleteReview}
                  disabled={bulkStatusAction !== null}>

                        Delete Selected ({selectedConnectionIds.length})
                      </Button>
                    </>
              }
                  <Button
                size="sm"
                variant="secondary"
                icon="sync"
                onClick={() => handleRunOneByOneTest()}
                disabled={oneByOneRunning}>

                    {oneByOneRunning ? "Testing Connection One-by-One..." : "Test Connection One-by-One"}
                  </Button>
                  {["codebuddy-cn", "qoder-cn"].includes(providerId) && connections.some((connection) => connection.authType === "oauth") && (
                    <>
                      <Button size="sm" variant="secondary" icon="sync" disabled={refreshingProfiles} onClick={async () => {
                        setRefreshingProfiles(true);
                        setProfileRefreshStatus("");
                        let failures = 0;
                        for (const connection of connections.filter((item) => item.authType === "oauth")) {
                          try {
                            const response = await dashboardRequest(`/api/providers/${encodeURIComponent(connection.id)}/refresh-profile`, { method: "POST" });
                            if (!response.ok) failures++;
                          } catch { failures++; }
                        }
                        await fetchConnections();
                        setProfileRefreshStatus(failures ? `${failures} profile refresh failed. Try again.` : "Profiles refreshed.");
                        setRefreshingProfiles(false);
                      }}>
                        {refreshingProfiles ? "Refreshing profiles..." : "Refresh profiles"}
                      </Button>
                      <span role="status">{profileRefreshStatus}</span>
                    </>
                  )}
                  {oneByOneRunning &&
              <Button
                size="sm"
                variant="ghost"
                icon="stop"
                onClick={handleStopOneByOneTest}
                disabled={oneByOneStopping}>

                      {oneByOneStopping ? "Stopping..." : "Stop"}
                    </Button>
              }
                </>
            }
              {connections.length > 1 &&
            <Button
              size="sm"
              variant="secondary"
              icon="swap_vert"
              onClick={handleReorderByStatus}
              disabled={connectionFilter.length > 0}
              title="Reorder by availability status">

                  Reorder
                </Button>
            }
              <div className="flex flex-wrap items-center gap-2">
                {uiV5 ? (
                  <div className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs text-dd-muted font-medium">Round Robin</span>
                    <Toggle
                      ariaLabel="Toggle round robin"
                      checked={providerStrategy === "round-robin"}
                      onChange={handleRoundRobinToggle} />
                  </div>
                ) : (
                  <>
                    <span className="text-xs text-dd-muted font-medium">Round Robin</span>
                    <Toggle
                      ariaLabel="Toggle round robin"
                      checked={providerStrategy === "round-robin"}
                      onChange={handleRoundRobinToggle} />
                  </>
                )}

                {providerStrategy === "round-robin" &&
              <div className="flex items-center gap-1.5">
                    <span className="text-xs text-dd-muted">Sticky:</span>
                    <input
                  type="number"
                  min={0}
                  title="0 keeps one account until it is unavailable"
                  value={providerStickyLimit}
                  onChange={(e) => handleStickyLimitChange(e.target.value)}
                  placeholder="1"
                  className="h-9 w-14 rounded-dd border border-dd-border bg-dd-surface px-2 text-xs text-dd-text outline-none focus:border-dd-accent focus-visible:shadow-dd-focus" />

                  </div>
              }
                {uiV5 ? (
                  <div className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs text-dd-muted font-medium ml-2">Cache Affinity</span>
                    <Toggle
                      ariaLabel="Toggle cache affinity"
                      checked={providerStrategy === "cache-affinity"}
                      onChange={handleCacheAffinityToggle} />
                  </div>
                ) : (
                  <>
                    <span className="text-xs text-dd-muted font-medium ml-2">Cache Affinity</span>
                    <Toggle
                      ariaLabel="Toggle cache affinity"
                      checked={providerStrategy === "cache-affinity"}
                      onChange={handleCacheAffinityToggle} />
                  </>
                )}
              </div>
              <div className="inline-flex items-center gap-2">
                <span className="text-xs text-dd-muted font-medium">Earliest Reset</span>
                <Toggle ariaLabel="Toggle earliest reset" checked={providerStrategy === "earliest-reset"} onChange={handleEarliestResetToggle} />
              </div>
              {/* Per-provider concurrency limit */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-dd-muted font-medium">Max Concurrent</span>
                <input
                type="number"
                min={0}
                value={concurrencyLimit}
                onChange={(e) => handleConcurrencyLimitChange(e.target.value)}
                placeholder="∞"
                className="min-h-11 w-16 rounded-dd border border-dd-border bg-dd-surface px-2 text-xs text-dd-text outline-none focus:border-dd-accent focus-visible:shadow-dd-focus" />

              </div>
              {/* OmniRoute #10920, adapted: egress-IP-bucketed 429 cooldown opt-in */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-dd-muted font-medium">Egress-Bucketed 429</span>
                <Toggle
                ariaLabel="Toggle egress-bucketed 429 cooldown"
                checked={egressBucketed}
                onChange={handleEgressBucketedChange} />

              </div>
              {/* OmniRoute #11104, adapted: operator per-provider error rules */}
              <Button
              size="sm"
              variant="secondary"
              icon="rule"
              onClick={() => setShowErrorRulesModal(true)}>

                  Error Rules{errorRules.length > 0 ? ` (${errorRules.length})` : ""}
                </Button>
            </div>
          </div>

          {connections.length === 0 ?
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-dd-accent-soft text-dd-accent shrink-0">
                  <span className="material-symbols-outlined text-[18px]">{isOAuth ? "lock" : "key"}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-dd-muted">No connections yet</p>
                  {hasDualAuthModes &&
              <p className="text-xs text-dd-muted">
                      Choose {oauthConnectionLabel}, {apiKeyConnectionLabel}{supportsAuthTokenAuth ? ", or Auth Token" : ""}.
                    </p>
              }
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {hasDualAuthModes ?
            <>
                    {isOAuth &&
                    <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection}>
                      {oauthConnectionLabel}
                    </Button>
                    }
                    {supportsApiKeyAuth &&
                    <Button size="sm" icon="key" onClick={() => triggerApiKeyConnection("apikey")}>
                      {apiKeyConnectionLabel}
                    </Button>
                    }
                    {supportsAuthTokenAuth &&
                    <Button size="sm" icon="token" variant="secondary" onClick={() => triggerApiKeyConnection("auth_token")}>
                      Auth Token
                    </Button>
                    }
                  </> :

            <>
                    {!isCompatible && providerId === "iflow" &&
              <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)}>
                        Cookie
                      </Button>
              }
                    {providerId === "codex" &&
              <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)}>
                        {translate("Bulk Add")}
                      </Button>
              }
                    {providerId === "grok-cli" &&
              <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportGrokCli(true)}>
                        {translate("Bulk Add")}
                      </Button>
              }
                    {cookieImportContract &&
              <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowCookieImportModal(true)}>
                      Import cookies
                    </Button>
              }
                    {providerId === "copilot-m365-web" &&
              <Button size="sm" icon="login" variant="secondary" onClick={() => setShowM365SignInModal(true)}>
                      Microsoft sign-in
                    </Button>
              }
                    <Button
                size="sm"
                icon="add"
                onClick={triggerAddConnection}>

                      {isCompatible ? "Add API Key" : providerId === "iflow" ? "OAuth" : "Add Connection"}
                    </Button>
                  </>
            }
              </div>
            </div> :

        <>
              {oneByOneSummary &&
          <div className="mb-4 rounded-dd bg-dd-surface-2 px-3 py-2 text-xs text-dd-muted">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Total: {oneByOneSummary.total}</span>
                    <span>Completed: {oneByOneSummary.completed}</span>
                    <span>Passed: {oneByOneSummary.passed}</span>
                    <span>Failed: {oneByOneSummary.failed}</span>
                    {oneByOneSummary.skipped > 0 && <span>Skipped: {oneByOneSummary.skipped}</span>}
                    {oneByOneSummary.unavailable > 0 && <span>Unavailable: {oneByOneSummary.unavailable}</span>}
                    {oneByOneSummary.stopped &&
              <span className="text-dd-warning">Stopped</span>
              }
                    {oneByOneRunning && oneByOneCurrentConnectionId &&
              <span>Running: {connections.find((conn) => conn.id === oneByOneCurrentConnectionId)?.name || oneByOneCurrentConnectionId}</span>
              }
                  </div>
                  {oneByOneSummary.unavailable > 0 && <ul aria-label="Unavailable connection tests" className="mt-2">
                    {connections.filter((conn) => oneByOneResults[conn.id]?.state === "unavailable").map((conn) => <li key={conn.id}>{conn.name || conn.email || conn.id}: Provider unavailable - try again later</li>)}
                  </ul>}
                  {hiddenTestResultCount > 0 && <div className="mt-2 flex flex-wrap items-center gap-2" role="status">
                    <span>{hiddenTestResultCount} completed {hiddenTestResultCount === 1 ? "result" : "results"} hidden by the filter.</span>
                    <Button size="sm" variant="secondary" onClick={() => { setConnectionFilter(""); setConnectionPageNumber(1); }}>Clear filter to view results</Button>
                  </div>}
                </div>
          }
              {connections.length > 0 &&
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-dd-border-subtle pb-2">
                  <Input aria-label="Filter connections" aria-describedby={connectionFilter.length > 0 ? "connection-filter-reorder-hint" : undefined} placeholder="Filter connections" value={connectionFilter} onChange={(event) => { setConnectionFilter(event.target.value); setConnectionPageNumber(1); }} />
                  <span aria-live="polite" className="text-xs text-dd-muted">{selectedConnectionIds.length} selected</span>
                  <label className="flex min-h-11 min-w-11 cursor-pointer items-center gap-1.5 text-xs text-dd-muted hover:text-dd-accent">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAllConnections}
                      className="h-3.5 w-3.5 rounded border-dd-border text-dd-accent focus:shadow-dd-focus" />
                    Select this page
                  </label>
                </div>
          }
              {connectionFilter.length > 0 && <p id="connection-filter-reorder-hint" role="status" className="mb-3 text-sm text-dd-muted">Clear the connection filter to reorder priorities.</p>}
              {selectedConnections.length > 0 && <details className="mb-3 text-sm text-dd-muted"><summary className="min-h-11 cursor-pointer py-3">Review {selectedConnections.length} selected connections</summary><ul>{selectedConnections.map((conn) => <li key={conn.id}>{conn.name || conn.email || conn.id} ({conn.id})</li>)}</ul></details>}
              {bulkFailures.length > 0 && <div role="alert" className="mb-3 text-sm text-dd-danger"><p>Some connections could not be updated:</p><ul>{bulkFailures.map((failure) => <li key={failure.id}>{failure.name} ({failure.id}): {failure.reason}</li>)}</ul></div>}
              {connectionsList}
              <label className="mt-3 flex items-center gap-2 text-xs text-dd-muted">
                Connections per page
                <select value={connectionPageSize} onChange={(event) => { setConnectionPageSize(Number(event.target.value)); setConnectionPageNumber(1); }} className="rounded border border-dd-border bg-transparent p-2">
                  {[10, 25, 50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              {pageCount > 1 && <nav aria-label="Connection pages" className="mt-3 flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setConnectionPageNumber(page - 1)}>Previous</Button>
                <span aria-live="polite" className="text-xs text-dd-muted">Page {page} of {pageCount} ({visibleConnections.length} matching)</span>
                <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setConnectionPageNumber(page + 1)}>Next</Button>
              </nav>}
              {canAddConnectionAfterFirst &&
          <div className="mt-4 grid grid-cols-1 gap-2 sm:flex">
                  {providerId === "iflow" &&
            <Button
              size="sm"
              icon="cookie"
              variant="secondary"
              onClick={() => setShowIFlowCookieModal(true)}
              title="Add connection using browser cookie"
              className="w-full sm:w-auto">

                      Cookie
                    </Button>
            }
                  {providerId === "codex" &&
            <Button
              size="sm"
              icon="playlist_add"
              variant="secondary"
              onClick={() => setShowBulkImportCodex(true)}
              title={translate("Bulk import codex accounts from JSON")}
              className="w-full sm:w-auto">

                      {translate("Bulk Add")}
                    </Button>
            }
                  {providerId === "grok-cli" &&
            <Button
              size="sm"
              icon="playlist_add"
              variant="secondary"
              onClick={() => setShowBulkImportGrokCli(true)}
              title={translate("Bulk import Grok CLI accounts from JSON")}
              className="w-full sm:w-auto">
                      {translate("Bulk Add")}
                    </Button>
            }
                  {providerId === "copilot-m365-web" &&
            <Button
              size="sm"
              icon="login"
              variant="secondary"
              onClick={() => setShowM365SignInModal(true)}
              title="Sign in with a work or school Microsoft account"
              className="w-full sm:w-auto">
                      Microsoft sign-in
                    </Button>
            }
                  {cookieImportContract &&
            <Button
              size="sm"
              icon="cookie"
              variant="secondary"
              onClick={() => setShowCookieImportModal(true)}
              title="Import cookies from a header, a cURL command, a HAR file or a browser extension"
              className="w-full sm:w-auto">
                      Import cookies
                    </Button>
            }
                  {hasDualAuthModes ?
            <>
                      {isOAuth &&
                      <Button
                size="sm"
                icon="lock"
                variant="secondary"
                onClick={triggerOAuthConnection}
                className="w-full sm:w-auto">

                        {oauthConnectionLabel}
                      </Button>
                      }
                      {supportsApiKeyAuth &&
                      <Button
                size="sm"
                icon="key"
                onClick={() => triggerApiKeyConnection("apikey")}
                className="w-full sm:w-auto">

                        {apiKeyConnectionLabel}
                      </Button>
                      }
                      {supportsAuthTokenAuth &&
                      <Button
                size="sm"
                icon="token"
                variant="secondary"
                onClick={() => triggerApiKeyConnection("auth_token")}
                className="w-full sm:w-auto">

                        Auth Token
                      </Button>
                      }
                    </> :

            <Button
              size="sm"
              icon="add"
              onClick={triggerAddConnection}
              className="w-full sm:w-auto">

                      Add
                    </Button>
            }
                </div>
          }
            </>
        }
        </Card>
      }

      {uiV5 ? autoSyncPanel : null}

      {/* Models */}
      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {"Available Models"}
            </h2>
            {providerThinkingLevels ? (
              <div className="w-44"><Select
                options={providerThinkingLevels.map((opt) => ({ value: opt, label: `Thinking: ${opt.charAt(0).toUpperCase() + opt.slice(1)}` }))}
                value={thinkingMode}
                onChange={(value) => handleThinkingModeChange(value)}
                title="Appends (level) suffix to copied model names"
                aria-label="Thinking mode"
                size="sm"
              /></div>
            ) : null}
          </div>
          {!isCompatible && (() => {
            const allIds = [
            ...models,
            ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id))].
            filter((m) => {const k = getModelKind(m);return !k || k === "llm";}).map((m) => m.id);
            const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));
            return (
              <div className="flex gap-2">
                {disabledModelIds.length > 0 &&
                <Button size="sm" variant="secondary" icon="restart_alt" onClick={handleEnableAll}>
                    Active All
                  </Button>
                }
                {activeIds.length > 0 &&
                <Button
                  size="sm"
                  variant="secondary"
                  icon={bulkTestingModels ? "progress_activity" : "science"}
                  onClick={() => handleDisableFailedModels(activeIds)}
                  disabled={!(connections.length > 0 || (isFreeNoAuth && !isDevinAgentic)) || bulkTestingModels || testingModelIds.size > 0}>
                    {bulkTestingModels ? "Testing Models..." : "Test & Disable Failed Models"}
                  </Button>
                }
                {activeIds.length > 0 &&
                <Button size="sm" variant="secondary" icon="block" onClick={() => handleDisableAll(activeIds)} disabled={bulkTestingModels}>
                    Disable All
                  </Button>
                }
              </div>);

          })()}
        </div>
        <p role="status" aria-live="polite" className="text-xs text-dd-danger mb-3 break-words">{modelsTestError}</p>
        {!!modelsTestMessage &&
        <p className="text-xs text-dd-success mb-3 break-words">{modelsTestMessage}</p>
        }
        {/* buildModelsList publishes compatible-provider catalogs from their
            custom/alias ids only and never applies this allowlist to them, so
            the control would silently do nothing for these providers. */}
        {!uiV5 ? autoSyncPanel : null}
        {!isCompatible &&
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon="visibility" onClick={() => setShowVisibleModels(true)}>
            Visible models{enabledModelIds.length > 0 ? ` (${enabledModelIds.length})` : ""}
          </Button>
          <span className="text-[11px] text-text-muted">
            {enabledModelIds.length > 0 ?
            `Only these ${enabledModelIds.length} models are exposed on /v1/models` :
            "All models are exposed on /v1/models"}
          </span>
        </div>
        }
        {providerId === "orcarouter" &&
        <div className="mb-4 rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-3">
            <p className="mb-2 text-xs font-medium text-dd-text">Model catalog</p>
            <OrcaModelDropdown
            connectionIds={connections.filter((conn) => conn.isActive !== false).map((conn) => conn.id)}
            selectedModel={selectedOrcaModel}
            onSelect={setSelectedOrcaModel}
            onClear={() => setSelectedOrcaModel("")} />

          </div>
        }
        <p className="mb-3 text-xs text-dd-muted">Models are catalog or configuration entries; they do not verify authentication or inference. Manual inference results apply only to this session.</p>
        {renderModelsSection()}
      </Card>

      {bulkActionModal}

      {/* Modals */}
      {providerId === "kiro" || providerId === "amazon-q" ?
      <KiroOAuthWrapper
        isOpen={showOAuthModal}
        provider={providerId}
        providerInfo={providerInfo}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)}
        proxyPools={proxyPools}
        proxyPoolsReady={proxyPoolsReady} /> :

      providerId === "cursor" ?
      <CursorAuthModal
        isOpen={showOAuthModal}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)} /> :

      providerId === "xiaomi-mimo" ?
      <XiaomiMimoAuthModal
        isOpen={showOAuthModal}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)} /> :

      providerId === "orcarouter" ?
      <OrcaRouterAuthModal
        isOpen={showOAuthModal}
        providerInfo={providerInfo}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)} /> :

      providerId === "gitlab" || providerId === "gitlab-duo" ?
      <GitLabAuthModal
        isOpen={showOAuthModal}
        provider={providerId}
        providerInfo={providerInfo}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)}
        proxyPools={proxyPools}
        proxyPoolsReady={proxyPoolsReady} /> :

      providerId === "ghe-copilot" ?
      <GheCopilotAuthModal
        isOpen={showOAuthModal}
        providerInfo={providerInfo}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)}
        proxyPools={proxyPools}
        proxyPoolsReady={proxyPoolsReady} /> :

      isImportToken ?
      providerId === "devin-desktop" && devinDesktopBrowserSignIn ?
      // Devin Desktop offers browser sign-in from its token import; switching back reopens the import.
      <OAuthModal
        isOpen={showOAuthModal}
        provider={providerId}
        providerInfo={providerInfo}
        onPasteToken={() => setDevinDesktopBrowserSignIn(false)}
        onSuccess={handleOAuthSuccess}
        onClose={() => {setShowOAuthModal(false);setReconnectConnectionId(null);}}
        proxyPools={proxyPools}
        proxyPoolsReady={proxyPoolsReady}
        connectionId={reconnectConnectionId} /> :

      <ImportTokenModal
        isOpen={showOAuthModal}
        provider={providerId}
        providerInfo={providerInfo}
        onBrowserSignIn={providerId === "devin-desktop" ? () => setDevinDesktopBrowserSignIn(true) : undefined}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)} /> :

      <OAuthModal
        isOpen={showOAuthModal}
        provider={providerId}
        providerInfo={providerInfo}
        onSuccess={handleOAuthSuccess}
        onClose={() => {setShowOAuthModal(false);setReconnectConnectionId(null);}}
        proxyPools={proxyPools}
        proxyPoolsReady={proxyPoolsReady}
        connectionId={reconnectConnectionId} />

      }
      {providerId === "copilot-m365-web" &&
      <CopilotM365AuthModal
        isOpen={showM365SignInModal}
        providerInfo={providerInfo}
        onSuccess={() => {fetchConnections();setShowM365SignInModal(false);}}
        onClose={() => setShowM365SignInModal(false)} />

      }
      {providerId === "iflow" &&
      <IFlowCookieModal
        isOpen={showIFlowCookieModal}
        onSuccess={handleIFlowCookieSuccess}
        onClose={() => setShowIFlowCookieModal(false)} />

      }
      <Modal
        isOpen={showImportTokenModal}
        title="Import Grok CLI Token"
        size="lg"
        onClose={() => {
          if (importingToken) return;
          setImportTokenError("");
          setShowImportTokenModal(false);
        }}
        footer={
        <>
            <Button
            variant="ghost"
            onClick={() => {
              setImportTokenError("");
              setShowImportTokenModal(false);
            }}
            disabled={importingToken}>

              Cancel
            </Button>
            <Button
            icon="upload"
            loading={importingToken}
            onClick={handleImportTokenSubmit}>

              Import
            </Button>
          </>
        }>

        <div className="space-y-4">
          <p className="text-sm text-dd-muted">
            Paste the contents of <code className="rounded bg-dd-surface-2 px-1 py-0.5">~/.grok/auth.json</code>, a raw Grok JWT, or a structured <code className="rounded bg-dd-surface-2 px-1 py-0.5">{"{ accessToken, refreshToken }"}</code> body.
          </p>
          <textarea
            aria-label="Import provider token"
            value={importTokenValue}
            onChange={(event) => setImportTokenValue(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded-[10px] border border-dd-border bg-dd-surface px-3 py-2 font-mono text-xs text-dd-text outline-none focus:border-dd-accent"
            placeholder='{"https://auth.x.ai::client":{"key":"eyJ...","refresh_token":"...","expires_at":"..."}}' />

          {!!importTokenError &&
          <p className="text-sm text-dd-danger">{importTokenError}</p>
          }
        </div>
      </Modal>
      <AddApiKeyModal
        key={showAddApiKeyModal ? "add-api-key-open" : "add-api-key-closed"}
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={apiKeyModalAuthType || providerInfo?.authType}
        authHint={providerInfo?.authHint}
        authSnippet={providerInfo?.authSnippet}
        website={providerInfo?.website}
        webLogin={providerInfo?.webLogin}
        proxyPools={proxyPools}
        existingConnectionNames={providerApiKeyConnectionNames}
        error={addConnectionError}
        onSave={handleSaveApiKey}
        onBulkDone={fetchConnections}
        onClose={() => {
          setAddConnectionError("");
          setApiKeyModalAuthType(null);
          setShowAddApiKeyModal(false);
        }} />

      <CookieImportModal
        key={showCookieImportModal ? "cookie-import-open" : "cookie-import-closed"}
        isOpen={showCookieImportModal}
        provider={providerId}
        providerName={providerInfo?.name}
        importContract={cookieImportContract}
        connections={connections}
        onSuccess={fetchConnections}
        onClose={() => setShowCookieImportModal(false)} />

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)} />

      {isCompatible &&
      <EditCompatibleNodeModal
        isOpen={showEditNodeModal}
        node={providerNode}
        onSave={handleUpdateNode}
        onClose={() => setShowEditNodeModal(false)}
        isAnthropic={isAnthropicCompatible} />

      }
      {scheduleConnection &&
      <AutoPingScheduleModal
        isOpen
        connection={scheduleConnection}
        schedule={autoPing.schedules?.[scheduleConnection.id] || null}
        onSave={(schedule) => handleSaveAutoPingSchedule(scheduleConnection.id, schedule)}
        onClose={() => setScheduleConnection(null)} />
      }
      <ProviderErrorRulesModal
        isOpen={showErrorRulesModal}
        providerId={providerId}
        rules={errorRules}
        onSave={saveErrorRules}
        onClose={() => setShowErrorRulesModal(false)} />

      {(!isCompatible || editingCustomModel) &&
      <AddCustomModelModal
        isOpen={showAddCustomModel || Boolean(editingCustomModel)}
        providerAlias={providerStorageAlias}
        providerDisplayAlias={providerDisplayAlias}
        initialModel={editingCustomModel}
        connections={connections}
        onSave={async (payload) => {
          // OmniRoute #14356 (port(omniroute)): a registry/synced row opens
          // this same editor with `editingCustomModel` set, but (unlike a
          // true custom-model edit) has no customModels row yet, so its first
          // save must go through POST (add), same as a brand-new custom
          // model. Only branch to update when a row for this id actually
          // exists; the plain "Add Model" flow (editingCustomModel null)
          // always adds, unchanged from before.
          const hasExistingRow = Boolean(editingCustomModel) && customModels.some(
            (m) => m?.id === payload.id && m.providerAlias === providerStorageAlias && (m.kind || m.type || "llm") === "llm"
          );
          if (hasExistingRow) {
            await handleUpdateCustomModel(payload);
          } else {
            await handleAddCustomModel(payload, payload.type || "llm", providerStorageAlias);
          }
          setShowAddCustomModel(false);
          setEditingCustomModel(null);
        }}
        onClose={() => {
          setShowAddCustomModel(false);
          setEditingCustomModel(null);
        }} />

      }

      {providerId === "codex" &&
      <BulkImportCodexModal
        isOpen={showBulkImportCodex}
        onClose={() => setShowBulkImportCodex(false)}
        onSuccess={fetchConnections} />

      }
      {providerId === "grok-cli" &&
      <BulkImportGrokCliModal
        isOpen={showBulkImportGrokCli}
        onClose={() => setShowBulkImportGrokCli(false)}
        onSuccess={fetchConnections} />
      }

      {showVisibleModels && !isCompatible &&
      <VisibleModelsModal
        key={providerStorageAlias}
        isOpen
        onClose={() => setShowVisibleModels(false)}
        providerId={providerId}
        providerAlias={providerStorageAlias}
        connections={connections}
        customModels={customModels}
        disabledModelIds={disabledModelIds}
        onSaved={(ids) => {
          if (currentProviderIdRef.current !== providerId) return;
          setEnabledModelIds(ids);
          fetchDisabledModels();
        }} />

      }

      {showSyncProviderModels && !isCompatible && <SyncProviderModelsModal
        connections={connections.filter((connection) => connection.isActive !== false)}
        existingIds={[...models.map((model) => model.id), ...customModels.filter((model) => model.providerAlias === providerStorageAlias).map((model) => model.id), ...Object.values(modelAliases).filter((model) => isString(model) && model.startsWith(`${providerStorageAlias}/`)).map((model) => model.slice(providerStorageAlias.length + 1))]}
        providerAlias={providerStorageAlias}
        passthrough={!!providerInfo.passthroughModels}
        onSaved={fetchAliases}
        onClose={() => setShowSyncProviderModels(false)} />}

      {/* AG Risk Confirmation Modal */}
      <ConfirmModal
        isOpen={showAgRiskModal}
        onClose={() => setShowAgRiskModal(false)}
        onConfirm={handleAgRiskConfirm}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText="Cancel"
        variant="danger" />

      <BulkReviewModal review={bulkReview?.review ?? null} onConfirm={confirmBulkReview} onCancel={cancelBulkReview} />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger" />

    </div>);

}
