"use client";

import PropTypes from "prop-types";
import { useDeferredValue, useMemo, useState } from "react";
import Input from "@/shared/ui/components/Input.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import { formatPolicyUsage, toggleApiKeyPolicyModel } from "../apiKeyPolicy";

const ACCESS_MODES = [
  { value: "all", label: "All models" },
  { value: "selected", label: "Selected models" },
];

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
  const limitReached = usageDisplay && (usageDisplay.tokensExceeded || usageDisplay.costExceeded);
  return (
    <div className="flex flex-col gap-3 rounded-dd-lg border border-dd-border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-semibold text-dd-text">Model access policy</p>
        <p className="text-xs text-dd-muted">Policies use canonical runtime model IDs and apply to every API modality.</p>
      </div>
      <SegmentedControl
        size="sm"
        value={draft.accessMode}
        onChange={(next) => onChange({ ...draft, accessMode: next })}
        options={ACCESS_MODES}
        aria-label="Model access scope"
      />
      {draft.accessMode === "selected" ? (
        <div className="flex flex-col gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models or providers"
            icon="search"
            aria-label="Search policy models"
          />
          <div
            tabIndex={0}
            className="max-h-48 overflow-y-auto rounded-dd border border-dd-border p-2"
            role="group"
            aria-label="Available policy models"
          >
            {loading ? (
              <p className="px-1 py-1 text-xs text-dd-muted">Loading active models…</p>
            ) : choices.length === 0 ? (
              <p className="px-1 py-1 text-xs text-dd-muted">No matching active models are currently available.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {choices.map((model) => (
                  <li key={model.id}>
                    <Checkbox
                      checked={selectedIds.has(model.id)}
                      onChange={() => onChange(toggleApiKeyPolicyModel(draft, model.id))}
                      label={model.name || model.displayId || model.id}
                      hint={[model.displayId, model.displayId && model.displayId !== model.id ? `Policy: ${model.id}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Lifetime token limit"
          type="number"
          min="0"
          step="1"
          value={draft.maxTokens}
          onChange={(event) => onChange({ ...draft, maxTokens: event.target.value })}
          placeholder="Unlimited"
        />
        <Input
          label="Lifetime cost limit (USD)"
          type="number"
          min="0"
          step="0.01"
          value={draft.maxCostUsd}
          onChange={(event) => onChange({ ...draft, maxCostUsd: event.target.value })}
          placeholder="Unlimited"
        />
      </div>
      {usage ? (
        <p
          className={`text-xs ${limitReached ? "text-dd-danger" : "text-dd-muted"}`}
          role={limitReached ? "alert" : undefined}
        >
          Committed usage: {usageDisplay.tokens} · {usageDisplay.cost} · {Number(usage.totalRequests || 0).toLocaleString()} requests
          {limitReached ? " · Limit reached" : ""}
        </p>
      ) : null}
    </div>
  );
}

ApiKeyPolicyFields.propTypes = {
  draft: PropTypes['shape']({ accessMode: PropTypes.string, allowedModels: PropTypes.array, maxTokens: PropTypes.oneOfType([PropTypes.string, PropTypes.number]), maxCostUsd: PropTypes.oneOfType([PropTypes.string, PropTypes.number]) }).isRequired,
  onChange: PropTypes.func.isRequired,
  catalog: PropTypes.array,
  usage: PropTypes.object,
  loading: PropTypes.bool,
};
