"use client";

import { dashboardRequest } from "../dashboardRequest";
import { filterModelRows, toggleVisibleModels, runModelOperations } from "../modelSelection.js";

import { Button } from "@/shared/components";

import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";

import { translate } from "@/i18n/runtime";
import { applyQoderModelNames, getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";

import ModelRow, { getDeclaredModelCapabilities } from "../ModelRow";

import CompatibleModelsSection from "../CompatibleModelsSection";

import { getCustomModelCapabilities } from "../customModelCapabilities";

import { isBrowser } from "../../../../../../shared/utils/typeChecks.js";

export default function buildModelsSection({ catalogEvidence, chutesCatalog, connections, copied, copy, customModels, disabledModelIds, fetchAliases, fetchCustomModels, fetchDisabledModels, getCaps, handleAddCustomModel, handleDeleteAlias, handleDeleteCustomModel, handleDisableModel, handleEnableModel, handleImportQoderModels, handleSetAlias, handleSyncModels, handleTestModel, importingQoderModels, isAnthropicCompatible, isCompatible, isDevinAgentic, isFreeNoAuth, kiloFreeModels, modelAliases, modelBulkBusy, modelFilter, modelGroup, modelOperator, modelSort, modelTestResults, models, modelsFetchedAt, providerDisplayAlias, providerGenerationRef, providerId, providerStorageAlias, resolveThinkingSuffix, selectedModels, setConfirmState, setEditingCustomModel, setModelBulkBusy, setModelFilter, setModelGroup, setModelOperator, setModelSort, setModelsTestError, setModelsTestMessage, setSelectedModels, setShowAddCustomModel, setShowSyncProviderModels, suggestedModels, syncingModels, testingModelIds }) {
  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          customModels={customModels}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          onAddCustomModel={(modelId) => handleAddCustomModel(modelId, "llm", providerStorageAlias)}
          onDeleteCustomModel={(modelId) => handleDeleteCustomModel(modelId, "llm", providerStorageAlias)}
          onEditCustomModel={(modelId) => {
            // Pass the persisted custom-model record (incl. capabilities) so
            // the modal's edit mode prefills the capability editor.
            const record = customModels.find((m) => m.id === modelId && m.providerAlias === providerStorageAlias && (m.kind || m.type || "llm") === "llm");
            if (record) setEditingCustomModel(record);
          }}
          onRefresh={() => Promise.all([fetchAliases(), fetchCustomModels()])}
          connections={connections}
          isAnthropic={isAnthropicCompatible} />);

    }
    // Combine hardcoded models with Kilo free models (deduplicated)
    // Exclude non-llm models (embedding, tts, etc.) — they have dedicated pages under media-providers
    const allModels = applyQoderModelNames([
    ...models,
    ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id))].
    filter((m) => {const k = getModelKind(m);return !k || k === "llm";}), customModels, providerStorageAlias);
    const disabledSet = new Set(disabledModelIds);
    const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
    const customModelRows = getProviderCustomModelRows({
      customModels,
      modelAliases,
      providerAlias: providerStorageAlias,
      // allModels (not just the static `models` registry) so a kiloFreeModels
      // row that picks up a capability override is excluded from the custom
      // list too, matching the row it actually overrides (port(omniroute) #14356).
      builtInModels: allModels,
      type: "llm"
    });

    const rows = [
      ...customModelRows.map((model) => ({ ...model, key: `${model.source}:${model.fullModel}`, group: "custom" })),
      ...allModels.map((model) => ({ ...model, key: `builtin:${model.id}`, group: disabledSet.has(model.id) ? "disabled" : "active" })),
    ];
    const visible = filterModelRows(rows, modelFilter, modelGroup, modelOperator, modelSort);
    const selected = rows.filter((model) => selectedModels.includes(model.key));
    const toggleModel = (key) => setSelectedModels((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
    const runBulk = async (action, targets) => {
      setModelBulkBusy(true);
      setModelsTestError("");
      setModelsTestMessage("");
      const requestGeneration = providerGenerationRef.current;
      const { succeeded, failed } = action === "delete" ? await runModelOperations(targets, async (model) => {
        const params = model.source === "custom" ? new URLSearchParams({ providerAlias: providerStorageAlias, id: model.id, type: "llm" }) : new URLSearchParams({ alias: model.alias });
        const res = await dashboardRequest(`/api/models/${model.source === "custom" ? "custom" : "alias"}?${params}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Request failed");
      }) : await (async () => {
        try {
          const params = new URLSearchParams({ providerAlias: providerStorageAlias });
          targets.forEach((model) => params.append("id", model.id));
          const res = action === "disable" ? await dashboardRequest("/api/models/disabled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerAlias: providerStorageAlias, ids: targets.map((model) => model.id) }) }) : await dashboardRequest(`/api/models/disabled?${params}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Request failed");
          return { succeeded: targets.map((model) => model.key), failed: [] };
        } catch { return { succeeded: [], failed: targets.map((model) => model.id) }; }
      })();
      if (providerGenerationRef.current !== requestGeneration) return;
      setSelectedModels((prev) => prev.filter((key) => !succeeded.includes(key)));
      if (action === "delete") { await Promise.all([fetchCustomModels(), fetchAliases()]); if (isBrowser()) window.dispatchEvent(new CustomEvent("customModelChanged")); }
      else await fetchDisabledModels();
      if (failed.length) setModelsTestError(`Could not ${action}: ${failed.join(", ")}`);
      if (succeeded.length) setModelsTestMessage(`${action} succeeded for ${succeeded.length} model(s).`);
      setModelBulkBusy(false);
    };
    const selectedActive = selected.filter((model) => model.group === "active");
    const selectedDisabled = selected.filter((model) => model.group === "disabled");
    const selectedCustom = selected.filter((model) => model.group === "custom");
    return (
      <div className="flex flex-wrap gap-3">
        <div className="w-full flex flex-wrap gap-2 items-center">
          <input aria-label="Filter models" type="search" placeholder="Filter models" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} className="rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-sm text-dd-text" />
          <select aria-label="Filter operator" value={modelOperator} onChange={(event) => setModelOperator(event.target.value)} className="rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-sm text-dd-text"><option value="contains">Contains</option><option value="notContains">Does not contain</option><option value="startsWith">Starts with</option><option value="endsWith">Ends with</option><option value="equals">Equals</option></select>
          <select aria-label="Sort models" value={modelSort} onChange={(event) => setModelSort(event.target.value)} className="rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-sm text-dd-text"><option value="">Default order</option><option value="asc">A to Z</option><option value="desc">Z to A</option></select>
          <select aria-label="Model group" value={modelGroup} onChange={(event) => setModelGroup(event.target.value)} className="rounded-dd border border-dd-border bg-dd-surface px-3 py-2 text-sm text-dd-text">
            <option value="all">All models</option><option value="active">Active</option><option value="disabled">Disabled</option><option value="custom">Custom</option>
          </select>
          <button type="button" disabled={modelBulkBusy || !visible.length} onClick={() => setSelectedModels((prev) => toggleVisibleModels(prev, visible))} className="text-sm text-dd-accent">{visible.length > 0 && visible.every((model) => selectedModels.includes(model.key)) ? "Deselect visible" : "Select visible"}</button>
          <span className="text-sm text-dd-muted">{selected.length} selected</span>
          {selected.length > 0 && <button type="button" disabled={modelBulkBusy} onClick={() => setSelectedModels([])} className="text-sm text-dd-accent">Clear selection</button>}
          {selectedActive.length > 0 && <Button size="sm" disabled={modelBulkBusy} onClick={() => runBulk("disable", selectedActive)}>Disable selected</Button>}
          {selectedDisabled.length > 0 && <Button size="sm" disabled={modelBulkBusy} onClick={() => runBulk("enable", selectedDisabled)}>Enable selected</Button>}
          {selectedCustom.length > 0 && <Button size="sm" disabled={modelBulkBusy} onClick={() => setConfirmState({ title: "Delete selected models", message: `Delete ${selectedCustom.length} selected custom model(s)? This cannot be undone.`, onConfirm: () => { setConfirmState(null); runBulk("delete", selectedCustom); } })}>Delete selected</Button>}
        </div>
        {visible.length === 0 && <p className="w-full text-sm text-dd-muted">No models match this filter.</p>}
        {/* Custom models first */}
        {visible.filter((model) => model.group === "custom").map((model) =>
        <ModelRow
          key={`${model.source}-${model.fullModel}`}
          selected={selectedModels.includes(`${model.source}:${model.fullModel}`)}
          onSelect={() => toggleModel(`${model.source}:${model.fullModel}`)}
          model={{ id: model.id, name: model.name }}
          fullModel={`${providerDisplayAlias}/${model.id}`}
          alias={model.alias}
          copied={copied}
          onCopy={copy}
          onSetAlias={() => {}}
          onDeleteAlias={() => {
            if (model.source === "custom") {
              handleDeleteCustomModel(model.id, "llm", providerStorageAlias);
            } else {
              handleDeleteAlias(model.alias);
            }
          }}
          testStatus={modelTestResults[model.id]}
          onTest={connections.length > 0 || (isFreeNoAuth && !isDevinAgentic) ? () => handleTestModel(model.id) : undefined}
          isTesting={testingModelIds.has(model.id)}
          isCustom
          isFree={false}
          declaredCaps={getDeclaredModelCapabilities(model)}
          caps={getCustomModelCapabilities({ providerId, modelId: model.id, capabilities: model.capabilities })}
          thinkingSuffix={resolveThinkingSuffix(model.id, model.capabilities)}
          onEdit={model.source === "custom" ? () => setEditingCustomModel(model) : undefined} />

        )}

        {visible.filter((model) => model.group === "active").map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(
            ([, m]) => m === fullModel || m === oldFormatModel
          )?.[0];
          // OmniRoute #14356 (port(omniroute)): a registry/synced model has no
          // customModels row by default, so it carries no capability override
          // (context window, etc). If the operator already saved one, merge it
          // over the base caps the same way the server's dedup pass does.
          const customOverride = customModels.find(
            (m) => m?.id === model.id && m.providerAlias === providerStorageAlias && (m.kind || m.type || "llm") === "llm"
          );
          const baseCaps = { ...getCaps(`${providerId}/${model.id}`), ...model.capabilities };
          return (
            <ModelRow
              key={model.id}
              selected={selectedModels.includes(`builtin:${model.id}`)}
              onSelect={() => toggleModel(`builtin:${model.id}`)}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onSetAlias={(alias) => handleSetAlias(model.id, alias, providerStorageAlias)}
              onDeleteAlias={() => handleDeleteAlias(existingAlias)}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 || (isFreeNoAuth && !isDevinAgentic) ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelIds.has(model.id)}
              isFree={model.isFree}
              onDisable={() => handleDisableModel(model.id)}
              declaredCaps={getDeclaredModelCapabilities(model, customOverride)}
              caps={customOverride ? { ...baseCaps, ...customOverride.capabilities } : baseCaps}
              thinkingSuffix={resolveThinkingSuffix(model.id, { ...baseCaps, ...customOverride?.capabilities })}
              onEdit={() => setEditingCustomModel({ id: model.id, name: model.name, capabilities: customOverride?.capabilities || {} })} />);

        })}

        {/* Add model button — inline, same style as model chips */}
        <button
          onClick={() => setShowAddCustomModel(true)}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-dd-accent/40 px-3 py-2 text-xs text-dd-accent transition-colors hover:border-dd-accent hover:bg-dd-accent-soft sm:w-auto">

          <span className="material-symbols-outlined text-sm">add</span>
          Add Model
        </button>

        <Button size="sm" variant="secondary" icon="sync" onClick={() => setShowSyncProviderModels(true)} disabled={!connections.some((connection) => connection.isActive !== false)}>
          Sync upstream models
        </Button>

        {/* Import Qoder models button — only show for qoder/qoder-cn provider */}
        {(providerId === "qoder" || providerId === "qoder-cn") && connections.some((conn) => conn.isActive !== false) &&
        <button
          onClick={handleImportQoderModels}
          disabled={importingQoderModels}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-dd-info/40 px-3 py-2 text-xs text-dd-info transition-colors hover:border-dd-info hover:bg-dd-info/10 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed">

            <span className={`material-symbols-outlined text-sm ${importingQoderModels ? "animate-spin motion-reduce:animate-none" : ""}`}>
              {importingQoderModels ? "progress_activity" : "download"}
            </span>
            {importingQoderModels ? translate("Fetching...") : translate("Fetch Qoder Models")}
          </button>
        }

        {(providerId === "cerebrium" || (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher) &&
        <button
          onClick={handleSyncModels}
          disabled={syncingModels}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-dd-accent/40 px-3 py-2 text-xs text-dd-accent transition-colors hover:bg-dd-accent-soft sm:w-auto disabled:opacity-50"
          title={modelsFetchedAt ? `Last synced ${modelsFetchedAt.toLocaleString()}` : "Fetch latest provider models"}>

            <span className={`material-symbols-outlined text-sm ${syncingModels ? "animate-spin" : ""}`}>sync</span>
            {syncingModels ? "Syncing…" : "Sync models"}
          </button>
        }

        {catalogEvidence && (catalogEvidence.source || catalogEvidence.degraded === true) &&
        <p role="status" className="w-full text-xs text-dd-muted">
          Catalog{catalogEvidence.source ? ` source: ${catalogEvidence.source}` : ""}{catalogEvidence.degraded === true ? " (degraded)" : ""}. This does not verify inference.
        </p>
        }

        {/* Suggested models from provider API — show only models not yet added */}
        {providerId === "chutes" && chutesCatalog.provider === providerId && chutesCatalog.status !== "loaded" &&
          <p role="status" className="w-full text-xs text-dd-muted">{chutesCatalog.status === "loading" ? "Loading Chutes models…" : chutesCatalog.status === "empty" ? "No Chutes models returned. You can add a model manually." : "Could not load Chutes models. You can add a model manually."}</p>
        }
        {(providerId === "chutes" ? chutesCatalog.provider === providerId && chutesCatalog.models.length > 0 : suggestedModels.length > 0) && (() => {
          const addedFullModels = new Set([
          ...Object.values(modelAliases),
          ...customModelRows.map((model) => model.fullModel)]
          );
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = (providerId === "chutes" ? chutesCatalog.models : suggestedModels).filter(
            (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id) && !disabledModelIds.includes(m.id)
          );
          if (notAdded.length === 0) return providerId === "chutes" ? <p role="status" className="w-full text-xs text-dd-muted">All available Chutes models are already added or disabled.</p> : null;
          return (
            <div className="w-full mt-2">
              <p className="text-xs text-dd-muted mb-2">Suggested free models (≥200k context):</p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((m) =>
                <button
                  key={m.id}
                  onClick={async () => {
                    await handleAddCustomModel(m.id, "llm", providerStorageAlias);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dd-border text-xs text-dd-muted hover:text-dd-accent hover:border-dd-accent/40 hover:bg-dd-accent-soft transition-colors"
                  title={`${m.name}${m.contextLength ? ` · ${(m.contextLength / 1000).toFixed(0)}k ctx` : ""}`}>

                    <span className="material-symbols-outlined text-[13px]">add</span>
                    <span className="min-w-0 break-all">{providerId === "chutes" ? m.id : m.id.split("/").pop()}</span>
                  </button>
                )}
              </div>
            </div>);

        })()}

        {/* Disabled models — restorable */}
        {disabledDisplayModels.length > 0 &&
        <div className="w-full mt-2">
            <p className="text-xs text-dd-muted mb-2">Disabled models ({disabledDisplayModels.length}):</p>
            <div className="flex flex-wrap gap-2">
              {visible.filter((m) => m.group === "disabled").map((m) =>
            <label key={m.id} className="flex items-center gap-1"><input type="checkbox" aria-label={`Select ${m.id}`} checked={selectedModels.includes(`builtin:${m.id}`)} onChange={() => toggleModel(`builtin:${m.id}`)} /><button
              key={m.id}
              onClick={() => handleEnableModel(m.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-dd-border text-xs text-dd-muted hover:text-dd-accent hover:border-dd-accent/40 hover:bg-dd-accent-soft transition-colors"
              title="Restore model">

                  <span className="material-symbols-outlined text-[13px]">add</span>
                  {m.id}
                </button></label>
            )}
            </div>
          </div>
        }
      </div>);

  };

  return { renderModelsSection };
}
