/**
 * A provider-agnostic quota fetcher for `openai-compatible-*` /
 * `anthropic-compatible-*` connections (ported from OmniRoute #13673).
 *
 * Every other adapter in this directory hard-codes one upstream's URL, auth
 * and response shape. A compatible connection can point at anything, so the
 * shape comes from the connection instead: the operator describes where the
 * quota lives and how to read it via `providerSpecificData.quotaEndpoint`.
 *
 *   {
 *     "url": "https://api.example.com/v1/credits",
 *     "method": "GET",                    // optional, default GET
 *     "auth": "bearer",                   // bearer | x-api-key | none
 *     "headers": { "X-Org": "acme" },     // optional, merged last
 *     "plan": "$.data.plan_name",         // optional label
 *     "quotas": {
 *       "credits": {
 *         "used": "$.data.used_usd",
 *         "total": "$.data.limit_usd",
 *         "resetAt": "$.data.renews_at",  // optional
 *         "currency": "usd"               // optional unit label
 *       }
 *     }
 *   }
 *
 * Paths are dot/bracket paths rather than full JSONPath (`$.a.b[0].c`), so the
 * mapping stays dependency-free and readable in a config field. Anything a
 * path cannot resolve is treated as absent, never as zero: a quota that
 * silently reads 0/0 looks exhausted, and an operator would reasonably act
 * on that.
 */
import {
  asRecord,
  finiteQuotaNumber,
  parseQuotaTimestamp,
  quotaMetadata,
  quotaScopedKey,
  quotaRow } from
"../normalize.js";
import {
  connectionCredential,
  connectionData,
  createProviderRequest,
  missingCredential,
  providerFailure,
  providerSuccess } from
"../providerHelpers.js";
import { isObject, isString } from "../../../../src/shared/utils/typeChecks.js";

/** `$.a.b[0].c` -> the value, or undefined if any hop is missing or unsafe. */
export function resolveQuotaPath(root, path) {
  if (!isString(path) || !path.trim()) return undefined;
  const cleaned = (path.startsWith("$") ? path.slice(1) : path).replace(/\[(\d+)\]/g, ".$1");
  const segments = cleaned.split(".").filter(Boolean);
  let cursor = root;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined || !isObject(cursor)) return undefined;
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment];
  }
  return cursor;
}

function buildAuthHeaders(endpoint, secret) {
  const mode = endpoint.auth === "x-api-key" || endpoint.auth === "none" ? endpoint.auth : "bearer";
  const headers = { Accept: "application/json" };
  if (secret && mode === "bearer") headers.Authorization = `Bearer ${secret}`;
  if (secret && mode === "x-api-key") headers["x-api-key"] = secret;
  const extra = asRecord(endpoint.headers) || {};
  for (const [key, value] of Object.entries(extra)) {
    if (isString(value)) headers[key] = value;
  }
  return headers;
}

/** One `quotas.<name>` mapping resolved against the response body. */
function buildQuotaRow(body, name, mapping) {
  if (!isObject(mapping)) return null;
  const limit = mapping.total === undefined ? null : finiteQuotaNumber(resolveQuotaPath(body, mapping.total));
  // Absent axis stays absent (never coerced to 0): a mapping that cannot
  // resolve a total has no scale to report a quota against.
  if (limit === null) return null;
  const used = mapping.used === undefined ? null : finiteQuotaNumber(resolveQuotaPath(body, mapping.used));
  const resetAt = mapping.resetAt === undefined ?
  null :
  parseQuotaTimestamp(resolveQuotaPath(body, mapping.resetAt));
  const unit = isString(mapping.currency) && mapping.currency.trim() ? mapping.currency.trim() : null;
  return quotaRow({
    resourceKey: quotaScopedKey("credits", name),
    dimensionKey: quotaScopedKey("credits", name),
    limitKind: "bounded",
    limit,
    used,
    unit,
    resetAt,
    metadata: quotaMetadata({ displayName: name })
  });
}

export async function fetchOpenAiCompatibleQuota(context) {
  const { config, connection } = context;
  const endpoint = asRecord(connectionData(connection).quotaEndpoint);
  if (!endpoint || !isString(endpoint.url) || !endpoint.url.trim()) return missingCredential(config);
  const mappings = asRecord(endpoint.quotas) || {};
  if (Object.keys(mappings).length === 0) return missingCredential(config);

  const auth = endpoint.auth === "x-api-key" || endpoint.auth === "none" ? endpoint.auth : "bearer";
  const secret = auth === "none" ? null : connectionCredential(connection, "apiKey", "accessToken");
  if (auth !== "none" && !secret) return missingCredential(config);

  const result = await createProviderRequest(context)(endpoint.url, {
    method: isString(endpoint.method) && endpoint.method.trim() ? endpoint.method.trim() : "GET",
    headers: buildAuthHeaders(endpoint, secret)
  });
  if (!result.ok) return providerFailure(config, result);

  const rows = Object.entries(mappings).
  map(([name, mapping]) => buildQuotaRow(result.data, name, mapping)).
  filter(Boolean);
  if (rows.length === 0) return providerFailure(config, { outcome: "malformed", attemptedAt: result.attemptedAt });
  return providerSuccess(config, rows, result.attemptedAt);
}
