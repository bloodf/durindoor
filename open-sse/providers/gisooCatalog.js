/**
 * Gisoo catalog discovery — keyless by design.
 *
 * `GET https://gisoo.pro/api/v1/models` is PUBLIC: it answers 200 with no
 * Authorization header and it answers 200 even when an invalid key is sent.
 * The catalog therefore needs no credential, and this resolver deliberately
 * sends none:
 *
 *   - the stored key never leaves the server for a request that does not need
 *     it, so model discovery can never disclose a key to a host the operator
 *     did not configure;
 *   - the request target is the registry constant below, never a
 *     connection-supplied `providerSpecificData.baseUrl`, so a management
 *     caller cannot redirect the catalog fetch (and with it the key) to a host
 *     of their choosing.
 *
 * Upstream contract: https://gisoo.pro/en/docs/quickstart and
 * https://gisoo.pro/api/v1/openapi.json (`GET /models`, `security: []`).
 */
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

/** The public catalog, restricted to chat models. */
export const GISOO_MODELS_URL = "https://gisoo.pro/api/v1/models?type=chat";

/**
 * Map one upstream catalog row onto a DurinDoor model entry.
 *
 * @param {object} model - one row of the upstream `data` array
 * @returns {object|null} a model entry, or null when the row carries no id
 */
export function normalizeGisooModel(model) {
  const id = isString(model?.id) ? model.id.trim() : "";
  if (!id) return null;
  const capabilities = isObject(model?.capabilities) ? model.capabilities : {};
  const entry = { id, name: isString(model?.name) && model.name ? model.name : id };
  if (isNumber(model?.context_length) && Number.isFinite(model.context_length)) entry.contextLength = model.context_length;
  if (isNumber(model?.max_output_tokens) && Number.isFinite(model.max_output_tokens)) entry.maxOutputTokens = model.max_output_tokens;
  if (capabilities.vision === true) entry.supportsVision = true;
  if (capabilities.reasoning === true) entry.supportsReasoning = true;
  return entry;
}

/**
 * Parse a Gisoo catalog payload into chat model entries.
 *
 * The upstream answers `{ object: "list", data: [...] }`; a bare array and an
 * OpenAI-style `{ models: [...] }` body are accepted too. Rows whose `type` is
 * present and not "chat" are dropped — the relay also publishes image, audio,
 * video, music and embedding ids that this chat provider cannot route.
 *
 * @param {unknown} data - the parsed catalog body
 * @returns {object[]} model entries
 */
export function parseGisooModels(data) {
  const rows = Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.models) ? data.models :
    [];
  const models = [];
  const seen = new Set();
  for (const row of rows) {
    if (!isObject(row)) continue;
    if (isString(row.type) && row.type && row.type !== "chat") continue;
    const entry = normalizeGisooModel(row);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    models.push(entry);
  }
  return models;
}

/**
 * Fetch the public Gisoo catalog without a credential.
 *
 * @param {{ fetchImpl: (url: string, init: object) => Promise<Response> }} options
 * @returns {Promise<{ models?: object[], error?: string, status?: number }>}
 */
export async function discoverGisooModels({ fetchImpl }) {
  const response = await fetchImpl(GISOO_MODELS_URL, {
    method: "GET",
    // No Authorization header: the catalog is public, so the stored key stays
    // on the server where it belongs.
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    return { error: `Failed to fetch models: ${response.status}`, status: response.status };
  }
  return { models: parseGisooModels(await response.json()) };
}
