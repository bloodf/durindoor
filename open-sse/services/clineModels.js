import { buildClineHeaders } from "../shared/clineAuth.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const CLINE_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
// The free tier is published only here: /api/v1/models carries no `cline-free/*`
// ids. Cline's SDK calls this feed unauthenticated, so no Authorization header.
// Source: decolua/9router#4334 (199173fe).
const CLINE_RECOMMENDED_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const FETCH_TIMEOUT_MS = 5000;

/** Free tier from the recommended-models feed. [] on any failure: it is additive only. */
async function fetchClineFreeTierModels(proxyOptions) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(CLINE_RECOMMENDED_MODELS_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }, proxyOptions);
    if (!response.ok) return [];
    const free = (await response.json())?.free;
    if (!Array.isArray(free)) return [];
    return free
      .filter((model) => isString(model?.id) && model.id.trim() !== "")
      .map((model) => ({ id: model.id, name: isString(model.name) && model.name ? model.name : model.id }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch Cline's live OAuth model catalog. Fail-soft so the registry remains the fallback.
 * Disabled by default until a valid disposable Cline OAuth connection confirms the live contract.
 *
 * @param {object} connection - Cline connection containing accessToken
 * @param {object} options - Connection networking options ({ proxyOptions })
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function resolveClineModels(connection, options = {}) {
  const token = isString(connection?.accessToken) ? connection.accessToken.trim() : "";
  if (!token || process.env.CLINE_LIVE_CATALOG !== "true") return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(CLINE_MODELS_ENDPOINT, {
      method: "GET",
      headers: buildClineHeaders(token, { Accept: "application/json" }),
      signal: controller.signal,
    }, options.proxyOptions || null);
    if (!response.ok) return [];

    const json = await response.json();
    const rawModels = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rawModels)) return [];

    const catalog = rawModels
      .filter((model) => isString(model?.id) && model.id && !model.id.startsWith("cline-pass/"))
      .map((model) => ({ id: model.id, name: isString(model.name) && model.name ? model.name : model.id }));

    // Catalog entry wins on a shared id; feed only adds the missing cline-free/* ids.
    const byId = new Map(catalog.map((model) => [model.id, model]));
    for (const model of await fetchClineFreeTierModels(options.proxyOptions || null)) {
      if (!byId.has(model.id) && !model.id.startsWith("cline-pass/")) byId.set(model.id, model);
    }
    return [...byId.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
