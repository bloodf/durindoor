// Per-instance token store + refresh-rotation helpers.

import { updateInstance, getInstanceById } from "@/lib/localDb";
import { isRecord } from "./guards";
import { assertOutboundUrlAllowed, OutboundUrlGuardError } from "open-sse/utils/outboundUrlGuard.js";
import { isNumber, isString } from "@/shared/utils/typeChecks.js";

const REFRESH_LEEWAY_MS = 60_000;
const KEY = "__9routerGatewayRefresh";
const DEFAULT_MAX_REDIRECT_HOPS = 10;

function inflightStore() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = new Map();
  }
  return globalThis[KEY];
}

function hasUsableToken(oauthTokens) {
  if (!oauthTokens?.access_token) return false;
  if (oauthTokens.needsReauth) return false;
  if (oauthTokens.expires_at === undefined) return true;
  return Date.now() < oauthTokens.expires_at - REFRESH_LEEWAY_MS;
}

/**
 * Extract refresh-handle metadata from a stored token bundle.
 * @param {object | null | undefined} oauthTokens
 * @returns {object | null}
 */
export function oauthMetaFromTokens(oauthTokens) {
  if (!oauthTokens) return null;
  const tokenEndpoint = oauthTokens.token_endpoint ?? oauthTokens.as?.token_endpoint ?? null;
  const clientId = oauthTokens.client?.clientId ?? oauthTokens.client_id ?? null;
  const clientSecret = oauthTokens.client?.clientSecret ?? oauthTokens.client_secret ?? null;
  const resource = oauthTokens.resource ?? null;
  if (!tokenEndpoint || !clientId) return null;
  return { tokenEndpoint, clientId, clientSecret: clientSecret ?? null, resource, maxRedirects: oauthTokens.maxRedirects };
}

/**
 * Ensure the instance's `oauthTokens` is fresh.
 * @param {object} instance
 * @param {object | null} meta
 * @returns {Promise<object>} the (possibly refreshed) instance
 */
export async function ensureFreshToken(instance, meta) {
  if (hasUsableToken(instance.oauthTokens)) return instance;
  if (!meta?.tokenEndpoint || !meta?.clientId) {
    return {
      ...instance,
      oauthTokens: { ...(instance.oauthTokens ?? {}), needsReauth: true }
    };
  }

  const store = inflightStore();
  const existing = store.get(instance.id);
  if (existing) return existing;

  const p = doRefresh(instance, meta).
  then((newTokens) => ({ ...instance, oauthTokens: newTokens })).
  catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[mcp-gw] refresh failed for ${instance.slug}: ${msg}`);
    // A concurrent request may have succeeded while this refresh failed.
    // If the stored access token is now different from the one we tried to
    // refresh, leave that newer token in place and do not mark reauth.
    const freshRow = await getInstanceById(instance.id).catch(() => null);
    const freshTokens = freshRow?.oauthTokens;
    if (freshTokens?.access_token && freshTokens.access_token !== instance.oauthTokens?.access_token) {
      return { ...instance, oauthTokens: freshTokens };
    }
    const failedTokens = { ...(instance.oauthTokens ?? {}), needsReauth: true };
    await updateInstance(instance.id, { oauthTokens: failedTokens }).catch(() => {});
    return {
      ...instance,
      oauthTokens: failedTokens
    };
  }).
  finally(() => {
    store.delete(instance.id);
  });
  store.set(instance.id, p);
  return p;
}

export async function doRefresh(instance, { tokenEndpoint, clientId, clientSecret, resource, maxRedirects }) {
  const refresh = instance.oauthTokens?.refresh_token;
  if (!refresh) {
    throw new Error("no refresh_token — re-login required");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: clientId
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (resource) body.set("resource", resource);

  const maxHops = isNumber(maxRedirects) && maxRedirects >= 0 ? maxRedirects : DEFAULT_MAX_REDIRECT_HOPS;

  // POST the refresh grant. Same-origin-only on 3xx — the AS may
  // legitimately 308/301 http→https or relocate the token endpoint,
  // but a cross-origin redirect would leak the refresh_token +
  // client_secret to an unrelated host. We manually re-validate every
  // hop via the SSRF guard and reject origin changes.
  let currentUrl;
  try {
    currentUrl = new URL(tokenEndpoint);
  } catch {
    throw new Error("token endpoint is not a valid URL");
  }
  try {
    assertOutboundUrlAllowed(currentUrl);
  } catch (err) {
    if (err instanceof OutboundUrlGuardError) {
      throw new Error(`token endpoint blocked: ${err.message}`);
    }
    throw err;
  }
  let res = null;
  for (let hop = 0; hop <= maxHops; hop++) {
    res = await fetch(currentUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      redirect: "manual"
    });
    if (!(res.status >= 300 && res.status < 400)) break;
    const location = res.headers.get("location");
    if (!location) break;
    if (hop === maxHops) {
      throw new Error(`refresh exceeded maximum ${maxHops} redirect(s)`);
    }
    let next;
    try {
      next = new URL(location, currentUrl);
    } catch {
      throw new Error("refresh redirect Location is not a valid URL");
    }
    try {
      assertOutboundUrlAllowed(next);
    } catch (err) {
      if (err instanceof OutboundUrlGuardError) {
        throw new Error(`refresh redirect blocked: ${err.message}`);
      }
      throw err;
    }
    if (next.origin !== currentUrl.origin) {
      throw new Error(`refresh redirect crossed origin: ${currentUrl.origin} → ${next.origin}`);
    }
    currentUrl = next;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`refresh ${res.status}: ${text.slice(0, 200)}`);
  }
  const raw = await res.json().catch(() => null);
  if (!isRecord(raw) || !isString(raw.access_token)) {
    throw new Error("refresh response missing access_token");
  }

  const newTokens = {
    ...(instance.oauthTokens ?? {}),
    access_token: raw.access_token,
    refresh_token: isString(raw.refresh_token) ? raw.refresh_token : refresh,
    token_type: isString(raw.token_type) ? raw.token_type : instance.oauthTokens?.token_type ?? "Bearer",
    scope: isString(raw.scope) ? raw.scope : instance.oauthTokens?.scope,
    expires_at: isNumber(raw.expires_in) ?
    Date.now() + raw.expires_in * 1000 :
    instance.oauthTokens?.expires_at,
    needsReauth: false,
    fetched_at: Date.now()
  };
  await updateInstance(instance.id, { oauthTokens: newTokens });
  return newTokens;
}

/**
 * Force a token refresh for the given instance, ignoring expiry leeway.
 * Reuses the per-instance inflight promise so concurrent forced refreshes
 * share one network request and one rotating refresh_token.
 * @param {object} instance
 * @param {object} [meta]
 * @returns {Promise<object | null>} the refreshed instance, or null on failure
 */
export async function refreshToken(instance, meta) {
  const m = meta ?? oauthMetaFromTokens(instance.oauthTokens);
  if (!m?.tokenEndpoint || !m?.clientId) return null;

  const store = inflightStore();
  const existing = store.get(instance.id);
  if (existing) {
    return existing.then((refreshed) =>
    refreshed?.oauthTokens?.needsReauth ? null : refreshed
    );
  }

  const p = doRefresh(instance, m).
  then((newTokens) => ({ ...instance, oauthTokens: newTokens })).
  catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[mcp-gw] forced refresh failed for ${instance.slug}: ${msg}`);
    const freshRow = await getInstanceById(instance.id).catch(() => null);
    const freshTokens = freshRow?.oauthTokens;
    if (freshTokens?.access_token && freshTokens.access_token !== instance.oauthTokens?.access_token) {
      return { ...instance, oauthTokens: freshTokens };
    }
    const failedTokens = { ...(instance.oauthTokens ?? {}), needsReauth: true };
    await updateInstance(instance.id, { oauthTokens: failedTokens }).catch(() => {});
    return { ...instance, oauthTokens: failedTokens };
  }).
  finally(() => {
    store.delete(instance.id);
  });
  store.set(instance.id, p);
  return p.then((refreshed) => refreshed?.oauthTokens?.needsReauth ? null : refreshed);
}

/**
 * Persist a fresh token bundle after authorize-code exchange or dynamic registration.
 * @param {string} instanceId
 * @param {object} partial
 * @returns {Promise<object>}
 */
export async function storeTokens(instanceId, partial) {
  const merged = {
    needsReauth: false,
    fetched_at: Date.now(),
    ...partial
  };
  await updateInstance(instanceId, { oauthTokens: merged });
  return merged;
}

/**
 * Load the latest tokens for an instance directly from the DB.
 * @param {string} instanceId
 * @returns {Promise<object | null>}
 */
export async function readFreshTokens(instanceId) {
  const inst = await getInstanceById(instanceId);
  return inst?.oauthTokens ?? null;
}