/**
 * Kiro model catalog fetcher.
 *
 * Calls AWS CodeWhisperer's `ListAvailableModels` endpoint to get the live
 * catalog for an authenticated Kiro account, then expands each upstream model
 * into 9router-shaped variants:
 *
 *   {upstream}                          - base model
 *   {upstream}-thinking                 - same model, thinking on at request time
 *   {upstream}-agentic                  - same model, chunked-write prompt prepended
 *   {upstream}-thinking-agentic         - both
 *
 * The `-thinking` and `-agentic` suffixes do not exist on the Kiro upstream
 * API. They are 9router fictions and the `openai-to-kiro` translator strips
 * them before the request leaves this process.
 *
 * The runtime UA is built to match what Kiro IDE itself sends, because the
 * upstream rejects requests with malformed `User-Agent` headers (returns 400
 * "format of value 'os/win/10 lang/js ...' is invalid").
 */

import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { refreshKiroToken } from "./tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { sanitizeErrorMessage } from "../utils/error.js";
import {
  KIRO_DEFAULT_REGION,
  regionFromProfileArn,
  resolveKiroRegion } from
"../config/kiroRegions.js";
import {
  buildKiroModelVariants,
  stripKiroSyntheticSuffixes } from
"../providers/models/kiroVariants.js";
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const KIRO_RUNTIME_SDK_VERSION = "1.0.0";
const KIRO_AGENT_OS = "windows";
const KIRO_AGENT_OS_VERSION = "10.0.26200";
const KIRO_NODE_VERSION = "22.21.1";
const KIRO_VERSION = "0.10.32";

const FETCH_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per credential

/**
 * Check whether an AWS SSO cache entry looks like a Kiro token.
 * Accepts Builder ID tokens (aorAAAAAG prefix), Microsoft Entra
 * (external_idp) tokens, and organization tokens carrying codewhisperer
 * scopes. Ported from 9router PR #2615 (`src/lib/oauth/kiroSsoCache.js`).
 */
export function isKiroSsoToken(data) {
  if (!data || !isString(data.refreshToken) || !data.refreshToken) return false;
  if (data.refreshToken.startsWith("aorAAAAAG")) return true;
  if (data.authMethod === "external_idp") return true;
  if (Array.isArray(data.scopes) && data.scopes.some((s) => String(s).includes("codewhisperer"))) return true;
  return false;
}

/**
 * Scan the AWS SSO cache (`~/.aws/sso/cache`) and resolve the full Kiro
 * credential bundle for a specific refresh token (unified SSO cache
 * resolution, 9router PR #2615).
 *
 * `targetRefreshToken` must match an entry exactly — this is what lets an
 * imported external_idp connection whose stored metadata is incomplete be
 * re-associated with the richer cache entry before a refresh is attempted.
 * The preferred `kiro-auth-token.json` file is checked first, but only wins
 * when it holds the requested token; otherwise every `*.json` entry is
 * scanned.
 *
 * For IDC/organization entries the linked client registration file
 * (`<clientIdHash>.json`) supplies clientId/clientSecret. The profileArn is
 * read from the Kiro IDE profile.json and used verbatim — rewriting its
 * region to us-east-1 breaks non-US IDC accounts (see
 * src/app/api/oauth/kiro/auto-import/route.js).
 *
 * @param {string} [targetRefreshToken] Exact refresh token to match. When
 *   null, returns the first Kiro-looking token found.
 * @returns {Promise<object>} { refreshToken, source, clientId, clientSecret,
 *   region, authMethod, profileArn, rawAuth }
 * @throws When the cache directory is unreadable or no entry matches.
 */
export async function resolveKiroCredentialsFromSsoCache(targetRefreshToken = null) {
  const cachePath = join(homedir(), ".aws/sso/cache");

  let files;
  try {
    files = await readdir(cachePath);
  } catch (error) {
    throw new Error("AWS SSO cache not found. Please login to Kiro IDE first.");
  }

  let refreshToken = null;
  let foundFile = null;
  let tokenData = null;

  const checkData = (data, file) => {
    if (!isKiroSsoToken(data)) return false;
    if (targetRefreshToken && data.refreshToken !== targetRefreshToken) return false;
    refreshToken = data.refreshToken;
    foundFile = file;
    tokenData = data;
    return true;
  };

  const kiroTokenFile = "kiro-auth-token.json";
  if (files.includes(kiroTokenFile)) {
    try {
      const content = await readFile(join(cachePath, kiroTokenFile), "utf-8");
      checkData(JSON.parse(content), kiroTokenFile);
    } catch (error) {}
  }

  if (!refreshToken) {
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await readFile(join(cachePath, file), "utf-8");
        if (checkData(JSON.parse(content), file)) break;
      } catch (error) {
        continue;
      }
    }
  }

  if (!refreshToken) {
    throw new Error(targetRefreshToken ?
    "Provided refresh token not found in local AWS SSO cache." :
    "Kiro token not found in AWS SSO cache. Please login to Kiro IDE first.");
  }

  // For IDC/organization tokens, resolve clientId and clientSecret from the
  // linked client registration file (referenced by clientIdHash).
  let clientId = null;
  let clientSecret = null;
  const region = tokenData?.region || null;
  const authMethod = tokenData?.authMethod || null;

  if (tokenData?.clientIdHash) {
    // clientIdHash comes from a local cache JSON file — treat it as input and
    // only accept the expected hex-hash shape (no path separators) before
    // joining it into a path, so a crafted entry cannot read files outside
    // the SSO cache.
    const safeHash = /^[0-9a-f]{1,128}$/i.test(String(tokenData.clientIdHash)) ?
    String(tokenData.clientIdHash) :
    null;
    if (safeHash) {
      try {
        const clientContent = await readFile(join(cachePath, `${safeHash}.json`), "utf-8");
        const clientData = JSON.parse(clientContent);
        if (clientData.clientId && clientData.clientSecret) {
          clientId = clientData.clientId;
          clientSecret = clientData.clientSecret;
        }
      } catch (error) {}
    }
  }

  // Read profileArn from Kiro IDE's profile.json, verbatim: the ARN already
  // carries the correct region for the account.
  let profileArn = null;
  const kiroProfilePaths = [
  join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Kiro", "User", "globalStorage", "kiro.kiroagent", "profile.json"),
  join(homedir(), ".config", "Kiro", "User", "globalStorage", "kiro.kiroagent", "profile.json")];

  for (const profilePath of kiroProfilePaths) {
    try {
      const profileData = JSON.parse(await readFile(profilePath, "utf-8"));
      if (profileData.arn) {
        profileArn = profileData.arn;
        break;
      }
    } catch (error) {
      continue;
    }
  }

  const rawAuth = authMethod === "external_idp" ? {
    auth_method: tokenData.authMethod,
    access_token: tokenData.accessToken,
    refresh_token: tokenData.refreshToken,
    client_id: tokenData.clientId || clientId,
    token_endpoint: tokenData.tokenEndpoint,
    scopes: tokenData.scopes,
    region: tokenData.region,
    profile_arn: profileArn,
    ...(tokenData.expiresAt ? { expired: tokenData.expiresAt } : null)
  } : undefined;

  return { refreshToken, source: foundFile, clientId, clientSecret, region, authMethod, profileArn, rawAuth };
}

/**
 * Enrich a Kiro credential from the local AWS SSO cache before a refresh is
 * attempted (9router PR #2615). Only fills fields the stored credential is
 * missing — never overwrites user-supplied metadata. Returns the same
 * reference when the cache cannot help (missing dir, token not cached, or
 * the credential already carries everything), so callers can pass the result
 * straight through to `refreshKiroToken`.
 */
export async function enrichKiroCredentialsFromSsoCache(credentials, log = null) {
  const psd = credentials?.providerSpecificData || {};
  if (!credentials?.refreshToken) return credentials;
  // Generic imports (no authMethod or the "imported" placeholder) always need
  // the cache lookup: the SSO cache entry may declare a more specific method
  // (external_idp / idc) plus the metadata that method's refresh requires.
  const genericMethod = !psd.authMethod || psd.authMethod === "imported";
  const needsExternalIdp = psd.authMethod === "external_idp" &&
  !(psd.clientId && psd.tokenEndpoint && psd.scope);
  const needsIdc = psd.authMethod === "idc" && !(psd.clientId && psd.clientSecret);
  const needsArn = !psd.profileArn;
  if (!genericMethod && !needsExternalIdp && !needsIdc && !needsArn) return credentials;

  let cached;
  try {
    cached = await resolveKiroCredentialsFromSsoCache(credentials.refreshToken);
  } catch (error) {
    log?.debug?.("KIRO_SSO", `SSO cache resolution skipped: ${sanitizeErrorMessage(error?.message || error)}`);
    return credentials;
  }

  // A cache entry declaring a concrete method (e.g. external_idp) upgrades a
  // generic imported credential wholesale; an explicit stored method is kept.
  const cachedMethod = cached.authMethod || null;
  const resolvedMethod = genericMethod && cachedMethod ? cachedMethod : psd.authMethod || cachedMethod || undefined;
  const cachedClientId = cached.clientId || cached.rawAuth?.client_id || null;
  const cachedScope = cached.rawAuth ? normalizeKiroSsoScope(cached.rawAuth.scopes) : "";

  return {
    ...credentials,
    providerSpecificData: {
      ...psd,
      ...(resolvedMethod ? { authMethod: resolvedMethod } : null),
      ...(psd.profileArn || !cached.profileArn ? null : { profileArn: cached.profileArn }),
      ...(psd.region || !cached.region ? null : { region: cached.region }),
      ...(psd.clientId || !cachedClientId ? null : { clientId: cachedClientId }),
      ...(psd.clientSecret || !cached.clientSecret ? null : { clientSecret: cached.clientSecret }),
      ...(psd.tokenEndpoint || !cached.rawAuth?.token_endpoint ? null : { tokenEndpoint: cached.rawAuth.token_endpoint }),
      ...(psd.scope || !cachedScope ? null : { scope: cachedScope })
    }
  };
}

function normalizeKiroSsoScope(scopes) {
  if (Array.isArray(scopes)) return scopes.map((s) => String(s).trim()).filter(Boolean).join(" ");
  return isString(scopes) ? scopes.trim() : "";
}

/** @type {Map<string, { expiresAt: number, models: any[] }>} */
const catalogCache = new Map();

/**
 * Strip the `-agentic` and/or `-thinking` suffixes from a synthetic id, if
 * any. The implementation lives in `providers/models/kiroVariants.js` next to
 * the variant generator so the live and static catalogs share one source.
 */
const stripSyntheticSuffixes = stripKiroSyntheticSuffixes;

/**
 * Build the per-account fingerprint headers Kiro upstream validates.
 * Keyed off whatever stable identifier we have for this credential, so the
 * same account always presents the same machineId.
 */
function buildKiroFingerprintHeaders(credentials) {
  const seed =
  credentials?.providerSpecificData?.clientId ||
  credentials?.refreshToken ||
  credentials?.providerSpecificData?.profileArn ||
  credentials?.accessToken ||
  "kiro-anonymous";
  const machineId = createHash("sha256").update(String(seed)).digest("hex");

  const userAgent =
  `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ua/2.1 ` +
  `os/${KIRO_AGENT_OS}#${KIRO_AGENT_OS_VERSION} ` +
  `lang/js md/nodejs#${KIRO_NODE_VERSION} ` +
  `api/codewhispererruntime#${KIRO_RUNTIME_SDK_VERSION} m/N,E ` +
  `KiroIDE-${KIRO_VERSION}-${machineId}`;
  const amzUserAgent = `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} KiroIDE-${KIRO_VERSION}-${machineId}`;

  return {
    "User-Agent": userAgent,
    "x-amz-user-agent": amzUserAgent,
    "x-amzn-kiro-agent-mode": "vibe",
    "x-amzn-codewhisperer-optout": "true",
    "amz-sdk-request": "attempt=1; max=1",
    "amz-sdk-invocation-id": uuidv4(),
    "Accept": "application/json"
  };
}

/**
 * Build the synthetic 9router variant set for a single upstream Kiro model.
 * Thin wrapper over `buildKiroModelVariants` (providers/models/kiroVariants.js)
 * so the static PROVIDER_MODELS.kr catalog and this live expansion share one
 * generator — including the `auto` special-case that skips `-agentic` /
 * `-thinking-agentic` (Kiro picks the underlying model server-side, so the
 * chunked-write agentic prompt is not meaningful; matches CLIProxyAPIPlus).
 */
function buildVariants(upstream, displayName) {
  return buildKiroModelVariants(upstream, displayName);
}

/**
 * Format the human-friendly display name for a Kiro model, including the
 * rate multiplier when it is something other than 1.0x.
 */
function formatDisplayName(modelName, modelId, rateMultiplier) {
  const base = (modelName || modelId || "Kiro").trim();
  const rate = Number(rateMultiplier);
  if (!Number.isFinite(rate) || Math.abs(rate - 1.0) < 1e-9 || rate <= 0) {
    return `Kiro ${base}`;
  }
  // Locale-independent decimal formatting.
  const rateStr = rate.toFixed(1).replace(",", ".");
  return `Kiro ${base} (${rateStr}x credit)`;
}

/**
 * Fetch the raw model catalog from Kiro. API-key credentials include Kiro's
 * required `TokenType: API_KEY` discriminator; OAuth credentials omit it.
 * Returns the array under `.models` from the API response, or throws on
 * network/HTTP error.
 */
async function fetchKiroCatalogRaw(credentials, signal, proxyOptions = null) {
  const profileArn = credentials?.providerSpecificData?.profileArn || "";
  const authMethod = credentials?.providerSpecificData?.authMethod;
  const region = regionFromProfileArn(profileArn) || resolveKiroRegion(credentials) || KIRO_DEFAULT_REGION;
  const params = new URLSearchParams();
  params.set("origin", "AI_EDITOR");
  if (profileArn) params.set("profileArn", profileArn);
  const url = `https://q.${region}.amazonaws.com/ListAvailableModels?${params.toString()}`;

  const headers = {
    ...buildKiroFingerprintHeaders(credentials),
    "Authorization": `Bearer ${credentials?.accessToken || ""}`,
    ...(authMethod === "api_key" ? { "TokenType": "API_KEY" } : null)
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  // Forward outer cancellation if any.
  let forwardAbort;
  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else if (signal && isFunction(signal.addEventListener)) {
    forwardAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", forwardAbort);
  }

  let response;
  try {
    response = await proxyAwareFetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    }, proxyOptions);
  } finally {
    clearTimeout(timer);
    if (forwardAbort && isFunction(signal.removeEventListener)) signal.removeEventListener("abort", forwardAbort);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(`Kiro ListAvailableModels ${response.status}: ${text || response.statusText}`);
    err.status = response.status;
    err.body = text;
    throw err;
  }

  const data = await response.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models;
}

/**
 * Build a stable cache key for a Kiro credential. Uses the most stable id we
 * have available so different login sessions for the same account share a
 * cache entry.
 */
function cacheKey(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const seed =
  psd.profileArn ||
  psd.clientId ||
  credentials?.refreshToken ||
  credentials?.accessToken ||
  "anonymous";
  return createHash("sha256").update(`kiro:${seed}`).digest("hex");
}

/**
 * Resolve the live Kiro model catalog for a credential and expand each entry
 * into 9router variants (`-thinking`, `-agentic`, `-thinking-agentic`). Each
 * variant retains the upstream input and output token limits.
 *
 * On any error (network, 4xx, 5xx), returns `null` so callers can fall back
 * to the static catalog without taking down the dashboard or `/v1/models`.
 *
 * @param {object} credentials Connection record (accessToken, refreshToken,
 *   providerSpecificData {profileArn, authMethod, clientId, clientSecret, region})
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh] Bypass the per-credential cache.
 * @param {object}  [options.log] Logger.
 * @param {object|null} [options.proxyOptions] Resolved connection egress route.
 * @param {function} [options.onCredentialsRefreshed] Persist refreshed token
 *   back to your credential store. Called with `{ accessToken, refreshToken,
 *   expiresIn }` whenever a 401 triggers a token refresh.
 * @returns {Promise<{ models: object[], rawModels: object[] } | null>}
 */
export async function resolveKiroModels(credentials, options = {}) {
  if (!credentials || !credentials.accessToken) {
    options.log?.debug?.("KIRO_MODELS", "No accessToken; skipping live fetch");
    return null;
  }

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) {
      return { models: cached.models, rawModels: cached.rawModels };
    }
  }

  let raw;
  try {
    raw = await fetchKiroCatalogRaw(credentials, options.signal, options.proxyOptions);
  } catch (err) {
    if (err && err.status === 401 && credentials.refreshToken) {
      options.log?.info?.("KIRO_MODELS", "Got 401 from Kiro; refreshing token");
      // Re-associate the stored refresh token with its SSO cache entry so an
      // imported external_idp/IDC connection missing clientId/clientSecret/
      // tokenEndpoint can still refresh (9router PR #2615).
      const enriched = await enrichKiroCredentialsFromSsoCache(credentials, options.log);
      const refreshed = await refreshKiroToken(
        enriched.refreshToken,
        enriched.providerSpecificData,
        options.log,
        options.proxyOptions
      );
      if (refreshed?.accessToken) {
        const next = { ...credentials, ...refreshed };
        if (isFunction(options.onCredentialsRefreshed)) {
          try {await options.onCredentialsRefreshed(refreshed);} catch (e) {
            options.log?.warn?.(
              "KIRO_MODELS",
              `onCredentialsRefreshed failed: ${sanitizeErrorMessage(e?.message || e)}`
            );
          }
        }
        try {
          raw = await fetchKiroCatalogRaw(next, options.signal, options.proxyOptions);
          // Update the in-memory credential reference too so retry logic uses
          // the fresh token consistently.
          credentials.accessToken = next.accessToken;
          if (next.refreshToken) credentials.refreshToken = next.refreshToken;
        } catch (err2) {
          options.log?.warn?.(
            "KIRO_MODELS",
            `Retry after refresh failed: ${sanitizeErrorMessage(err2?.message || err2)}`
          );
          return null;
        }
      } else {
        options.log?.warn?.("KIRO_MODELS", "Token refresh did not return accessToken");
        return null;
      }
    } else {
      options.log?.warn?.(
        "KIRO_MODELS",
        `ListAvailableModels failed: ${sanitizeErrorMessage(err?.message || err)}`
      );
      return null;
    }
  }

  const expanded = [];
  for (const m of raw) {
    if (!m || !isObject(m)) continue;
    const upstreamId = m.modelId || m.id;
    if (!upstreamId) continue;
    const display = formatDisplayName(m.modelName, upstreamId, m.rateMultiplier);
    const ctx = Number(m?.tokenLimits?.maxInputTokens) || 200_000;
    const maxOutputTokens = Number(m?.tokenLimits?.maxOutputTokens) || null;
    for (const v of buildVariants(upstreamId, display)) {
      expanded.push({
        ...v,
        // Carry over context window + raw upstream metadata so the caller
        // (e.g. the dashboard models endpoint) can render it.
        contextLength: ctx,
        ...(maxOutputTokens ? { maxOutputTokens } : null),
        rateMultiplier: Number.isFinite(Number(m.rateMultiplier)) ? Number(m.rateMultiplier) : 1.0,
        upstreamModelId: upstreamId,
        description: m.description || ""
      });
    }
  }

  catalogCache.set(key, {
    expiresAt: now + CACHE_TTL_MS,
    models: expanded,
    rawModels: raw
  });

  return { models: expanded, rawModels: raw };
}

/**
 * Drop any cached catalog for this credential. Call this after rotating /
 * importing tokens so the next fetch is fresh.
 */
export function invalidateKiroModelCache(credentials) {
  if (!credentials) return;
  catalogCache.delete(cacheKey(credentials));
}

/**
 * Drop the entire in-memory cache. Mostly for tests / manual debug.
 */
export function clearKiroModelCache() {
  catalogCache.clear();
}