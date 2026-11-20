import { isString } from "@/shared/utils/typeChecks.js";

/** Fetch and merge active Antigravity account catalogs; null retains the fallback. */
export async function loadLiveAntigravityModels(connections, { fetchImpl = fetch, signal } = {}) {
  const active = connections.filter((connection) => connection.isActive !== false && connection.id);
  const results = await Promise.all(active.map(async (connection) => {
    try {
      const response = await fetchImpl(`/api/providers/${encodeURIComponent(connection.id)}/models`, { cache: "no-store", signal });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    } catch {
      return [];
    }
  }));
  const models = new Map();
  for (const result of results) for (const model of result) {
    if (isString(model?.id) && model.id && !models.has(model.id)) models.set(model.id, model);
  }
  return models.size ? [...models.values()] : null;
}
