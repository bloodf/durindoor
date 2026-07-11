"use client";

import PropTypes from "prop-types";
import { useDeferredValue, useMemo, useState } from "react";
import { Input } from "@/shared/components";
import { formatPolicyUsage, toggleApiKeyPolicyModel } from "../apiKeyPolicy";

export default function ApiKeyPolicyFields({ draft, onChange, catalog = [], usage = null, loading = false }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const selectedIds = useMemo(() => new Set(draft.allowedModels || []), [draft.allowedModels]);
  const choices = useMemo(() => {
    const catalogById = new Map(catalog.map((model) => [model.id, model]));
    const all = [...catalog];
    for (const id of draft.allowedModels || []) {
      if (!catalogById.has(id)) all.push({ id, displayId: id, name: `${id} (currently unavailable)` });
    }
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((model) => [model.name, model.id, model.displayId, model.provider]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [catalog, deferredQuery, draft.allowedModels]);
  const usageDisplay = usage ? formatPolicyUsage(usage, draft) : null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-medium">Model access policy</p>
        <p className="text-xs text-text-muted">Policies use canonical runtime model IDs and apply to every API modality.</p>
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={draft.accessMode === "all"} onChange={() => onChange({ ...draft, accessMode: "all" })} />
          All models
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={draft.accessMode === "selected"} onChange={() => onChange({ ...draft, accessMode: "selected" })} />
          Selected models
        </label>
      </div>
      {draft.accessMode === "selected" && (
        <div className="flex flex-col gap-2">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models or providers" />
          <div className="max-h-48 overflow-y-auto rounded border border-border p-2">
            {loading ? (
              <p className="text-xs text-text-muted">Loading active models…</p>
            ) : choices.length === 0 ? (
              <p className="text-xs text-text-muted">No matching active models are currently available.</p>
            ) : choices.map((model) => (
              <label key={model.id} className="flex items-start gap-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={selectedIds.has(model.id)}
                  onChange={() => onChange(toggleApiKeyPolicyModel(draft, model.id))}
                />
                <span>
                  <span className="font-medium">{model.name || model.displayId || model.id}</span><br />
                  <code className="text-text-muted">{model.displayId || model.id}</code>
                  {model.displayId && model.displayId !== model.id && <><br /><code className="text-text-muted">Policy: {model.id}</code></>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Lifetime token limit" type="number" min="0" step="1" value={draft.maxTokens} onChange={(event) => onChange({ ...draft, maxTokens: event.target.value })} placeholder="Unlimited" />
        <Input label="Lifetime cost limit (USD)" type="number" min="0" step="0.01" value={draft.maxCostUsd} onChange={(event) => onChange({ ...draft, maxCostUsd: event.target.value })} placeholder="Unlimited" />
      </div>
      {usage && (
        <p className={`text-xs ${usageDisplay.tokensExceeded || usageDisplay.costExceeded ? "text-red-500" : "text-text-muted"}`}>
          Committed usage: {usageDisplay.tokens} · {usageDisplay.cost} · {Number(usage.totalRequests || 0).toLocaleString()} requests
          {(usageDisplay.tokensExceeded || usageDisplay.costExceeded) && " · Limit reached"}
        </p>
      )}
    </div>
  );
}

ApiKeyPolicyFields.propTypes = {
  draft: PropTypes.shape({ accessMode: PropTypes.string, allowedModels: PropTypes.array, maxTokens: PropTypes.oneOfType([PropTypes.string, PropTypes.number]), maxCostUsd: PropTypes.oneOfType([PropTypes.string, PropTypes.number]) }).isRequired,
  onChange: PropTypes.func.isRequired,
  catalog: PropTypes.array,
  usage: PropTypes.object,
  loading: PropTypes.bool,
};
