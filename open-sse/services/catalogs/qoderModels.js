/**
 * Qoder model catalog fetcher.
 *
 * Calls /algo/api/v2/model/list (COSY-signed) on the inference host to get
 * the live catalog for an authenticated Qoder account, then caches the
 * per-model `model_config` blocks by key. Chat requests later look up the
 * exact server-published metadata for the model they want — Qoder's chat
 * endpoint silently downgrades to a different model when the wrong
 * model_config is sent.
 *
 * On any error the live cache stays empty and chatExecuteCall surfaces the
 * problem to the user as "model config not yet fetched, retry shortly".
 */

import { createHash } from "crypto";

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { buildCosyHeaders } from "../../shared/qoder/cosy.js";
import {
  qoderRegionOf,
  qoderModelListUrl } from
"../../shared/qoder/constants.js";
import { createCatalogCache } from "./catalogCache.js";
import { isFunction, isObject } from "../../../src/shared/utils/typeChecks.js";

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Stable cache key per access credential and region. Account IDs alone do not
 * establish that two connections have the same entitlements or billing context.
 */
function cacheKey(credentials, region) {
  const psd = credentials?.providerSpecificData || {};
  const seed = JSON.stringify([region, psd.userId || "", credentials?.accessToken || ""]);
  return createHash("sha256").update(`qoder:${seed}`).digest("hex");
}

// Concurrent first-time callers (parallel chat windows) share one load, so each
// credential fans out exactly one upstream request per miss.
const catalogCache = createCatalogCache({ ttlMs: CACHE_TTL_MS, keyFn: cacheKey });

/**
 * Strip credential -> COSY creds for buildCosyHeaders.
 */
function cosyCredsFromConnection(credentials) {
  const psd = credentials?.providerSpecificData || {};
  return {
    userId: psd.userId,
    authToken: credentials.accessToken,
    name: credentials.displayName || "",
    email: credentials.email || "",
    machineId: psd.machineId || ""
  };
}

/**
 * Fetch the live model list for this credential. Returns:
 *   { models: [{ id, name, contextLength, isVL, isReasoning, ... }, ...],
 *     rawConfigs: Map<modelKey, modelConfigObject> }
 * or `null` on any error.
 */
async function fetchQoderCatalogRaw(credentials, signal, proxyOptions = null, region = "intl") {
  const creds = cosyCredsFromConnection(credentials);
  if (!creds.userId || !creds.authToken) return null;
  const modelListUrl = qoderModelListUrl(region);

  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    ...buildCosyHeaders(Buffer.alloc(0), modelListUrl, creds)
  };

  const controller = new AbortController();
  let timer = null;
  let abortListener = null;
  let response;
  try {
    timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
    if (signal && isFunction(signal.addEventListener)) {
      // If the parent signal already aborted before we got here, the
      // 'abort' event has already fired and addEventListener won't
      // re-trigger it. Propagate the cancellation immediately.
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        abortListener = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abortListener);
      }
    }
    response = await proxyAwareFetch(
      modelListUrl,
      {
        method: "GET",
        headers,
        signal: controller.signal
      },
      proxyOptions
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

  if (!response.ok) return null;

  const body = await response.json().catch(() => null);
  if (!body || !Array.isArray(body.chat)) return null;

  const models = [];
  const rawConfigs = new Map();
  for (const entry of body.chat) {
    if (!entry || !isObject(entry)) continue;
    const key = entry.key;
    if (!key) continue;

    // Qoder still serves these models when the catalog marks them disabled.
    rawConfigs.set(key, entry);

    const display = entry.display_name || key;
    const ctx = Number(entry.max_input_tokens) || 131_072;
    models.push({
      id: key,
      name: `${display}`,
      contextLength: ctx,
      isVL: !!entry.is_vl,
      isReasoning: !!entry.is_reasoning,
      maxOutputTokens: Number(entry.max_output_tokens) || 0,
      description: entry.description || ""
    });
  }

  // Upstream sometimes omits the "cmodel" (Cantus) entry entirely, which
  // makes qd/cmodel fail with "model_config for cmodel not yet known".
  // Synthesize it from a real sibling config (preferred) or exact upstream
  // defaults — but never touch an upstream-provided cmodel.
  if (!rawConfigs.has("cmodel")) {
    const fallbackConfig = body.chat.find((entry) => entry && entry.key && rawConfigs.has(entry.key)) || null;
    const cmodelConfig = fallbackConfig ?
    { ...fallbackConfig, key: "cmodel", display_name: "Cantus" } :
    {
      key: "cmodel",
      enable: true,
      display_name: "Cantus",
      max_input_tokens: 131072,
      max_output_tokens: 64000,
      is_vl: false,
      is_reasoning: false,
      description: "Qoder Cantus (C-model)"
    };
    rawConfigs.set("cmodel", cmodelConfig);
    models.push({
      id: "cmodel",
      name: "Cantus",
      contextLength: Number(cmodelConfig.max_input_tokens) || 131_072,
      isVL: !!cmodelConfig.is_vl,
      isReasoning: !!cmodelConfig.is_reasoning,
      maxOutputTokens: Number(cmodelConfig.max_output_tokens) || 0,
      description: cmodelConfig.description || ""
    });
  }

  return { models, rawConfigs };
}

/**
 * Get the cached model_config block for a given model key, fetching the
 * catalog first if needed. Returns null when the catalog can't be fetched
 * (so callers can fall back to the static registry).
 */
export async function getQoderModelConfig(credentials, modelKey, options = {}) {
  const cached = await resolveQoderModels(credentials, options);
  if (!cached) return null;
  const config = cached.rawConfigs.get(modelKey);
  if (!config) return null;
  // Defensive copy — chat code may mutate `key` to align with the alias path.
  return { ...config, key: modelKey };
}

/**
 * Resolve the live model catalog + raw configs for a credential. Caches
 * results for CACHE_TTL_MS so repeated chat requests don't re-fetch, and
 * deduplicates concurrent misses so parallel chat windows fan-out exactly
 * one upstream request per credential.
 */
export async function resolveQoderModels(credentials, options = {}) {
  if (!credentials?.accessToken) return null;
  const psd = credentials.providerSpecificData || {};
  if (!psd.userId) return null;

  const region = options.region || qoderRegionOf(credentials?.provider);
  const key = catalogCache.keyFor(credentials, region);

  // forceRefresh callers still get their own fetch (they wanted fresh data).
  return catalogCache.load(key, async () => {
    const fetched = await fetchQoderCatalogRaw(credentials, options.signal, options.proxyOptions, region);
    if (!fetched) return null;
    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      models: fetched.models,
      rawConfigs: fetched.rawConfigs,
      fetched: true
    };
  }, { force: Boolean(options.forceRefresh) });
}

export function invalidateQoderCatalog(credentials) {
  if (!credentials) return;
  catalogCache.delete(catalogCache.keyFor(credentials, qoderRegionOf(credentials?.provider)));
}

export function clearQoderCatalog() {
  catalogCache.clear();
}