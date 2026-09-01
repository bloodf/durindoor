import { buildClineHeaders } from "../shared/clineAuth.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const CLINE_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const FETCH_TIMEOUT_MS = 5000;

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

    return rawModels
      .filter((model) => isString(model?.id) && model.id && !model.id.startsWith("cline-pass/"))
      .map((model) => ({ id: model.id, name: isString(model.name) && model.name ? model.name : model.id }))
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
