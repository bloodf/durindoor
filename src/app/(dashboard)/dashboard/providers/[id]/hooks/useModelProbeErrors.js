import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatModelProbeErrors, updateModelProbeErrors } from "@/shared/utils/modelTestResults.js";

/** Transient errors belong to the current provider, probe connection and model inventory. */
export default function useModelProbeErrors(providerAlias, connectionId, modelIds, surfaceContext = null) {
  const context = JSON.stringify([providerAlias, connectionId || "auto", surfaceContext]);
  const token = useMemo(() => ({ context }), [context]);
  const inventory = JSON.stringify([...new Set(modelIds)].sort());
  const current = useRef(null);
  const models = useMemo(() => new Set(JSON.parse(inventory)), [inventory]);
  const [stored, setStored] = useState(() => ({ token, inventory, errors: {},
    modelTokens: new Map(modelIds.map((id) => [id, {}])),
  }));
  let state = stored;
  if (stored.token !== token || stored.inventory !== inventory) {
    state = { token, inventory,
      modelTokens: new Map([...models].map((id) => [id, stored.token === token && stored.modelTokens.get(id) || {}])),
      errors: stored.token === token ?
      Object.fromEntries(Object.entries(stored.errors).filter(([, entry]) => models.has(entry.model.slice(providerAlias.length + 1)))) : {} };
    setStored(state);
  }

  const modelTokens = state.modelTokens;
  useLayoutEffect(() => {
    current.current = { token, modelTokens };
    return () => { current.current = null; };
  }, [token, modelTokens]);

  const isCurrent = (modelId) => current.current?.token === token && modelTokens.has(modelId) &&
    current.current.modelTokens.get(modelId) === modelTokens.get(modelId);

  const recordError = (modelId, error) => {
    // A probe completing after navigation, account changes or model removal
    // must not restore a retired error. Bulk probes use this same completion.
    if (!isCurrent(modelId)) return;
    setStored((previous) => ({ ...previous, errors: updateModelProbeErrors(
      previous.errors, `${providerAlias}/${modelId}`, connectionId, error,
    ) }));
  };
  return { error: formatModelProbeErrors(state.errors), recordError, isCurrent };
}
