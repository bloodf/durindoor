/**
 * SenseNova Token Plan usage (port of OmniRoute #20403).
 * Based on cheaper-inference/OmniRoute (MIT), sensenovaQuotaFetcher.ts at
 * cb67bb6521980b8a2c1d5a28fa2bbd0e5667fca0; see LICENSE and the port report.
 * Copyright (c) 2026 Cheaper Inference - Created by Diego Souza
 * https://github.com/diegosouzapw
 *
 * The balance lives behind the console gateway, which rejects the inference API
 * key. It accepts only a console session JWT (3h TTL), obtained by exchanging a
 * refresh token stored in providerSpecificData. The exchange ROTATES the refresh
 * token: the consumed one stops working. So:
 *   - a rotated token is persisted with a compare-and-swap on the stored value
 *     before it is used;
 *   - concurrent refreshes share one exchange in-process and claim a lease on the
 *     row across processes, so no two refreshes spend the same token;
 *   - a rotation whose write failed stays in process memory (the consumed token
 *     is dead), and a failed exchange keeps the last good token untouched.
 * Tokens are never logged; they only travel to the two fixed SenseNova hosts.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { isRecord as isObject, isString } from "../../../src/shared/utils/typeChecks.js";

export const SENSENOVA_POOL_USAGE_URL = "https://platform.sensenova.cn/lite/console/v1/tokenplan/pool-usage";
export const SENSENOVA_TOKEN_URL = "https://signin.sensecore.cn/oauth2/token";
export const PSD_REFRESH = "sensenovaRefreshToken";
export const PSD_ACCESS = "sensenovaAccessToken";
export const PSD_ACCESS_EXPIRES = "sensenovaAccessTokenExpiresAt";
export const PSD_LEASE = "sensenovaRefreshLease";

const EXPIRY_MARGIN_MS = 120_000;
const LEASE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_ACCESS_TTL_SECONDS = 10_800;
const PLAN = "SenseNova Token Plan";

const defaultDeps = {
  // Resolved per call so importing this module never reads the export eagerly.
  fetch: (...args) => proxyAwareFetch(...args),
  now: () => Date.now(),
  clientId: () => process.env.SENSENOVA_CLIENT_ID || "nova",
  async readConnection(id) {
    const { getProviderConnectionById } = await import("../../../src/lib/localDb.js");
    return getProviderConnectionById(id);
  },
  async swap(id, expected, next) {
    const { compareAndSwapProviderSpecificData } = await import("../../../src/lib/localDb.js");
    return compareAndSwapProviderSpecificData(id, expected, next);
  }
};
let deps = defaultDeps;
const inflight = new Map(); // connectionId -> { token, promise }
const memoryRotations = new Map(); // connectionId -> { basedOn, refreshToken, accessToken, expiresAt }

export function __setSensenovaDepsForTesting(overrides) {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
  inflight.clear();
  memoryRotations.clear();
}

const psdOf = (conn) => (isObject(conn?.providerSpecificData) ? conn.providerSpecificData : {});
const str = (v) => (isString(v) && v.length > 0 ? v : null);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function liveAccess(token, expiresAt, allowExpiring = false) {
  if (!str(token)) return null;
  const deadline = num(expiresAt) - (allowExpiring ? 0 : EXPIRY_MARGIN_MS);
  return deadline > deps.now() ? token : null;
}

function rowAccess(psd, allowExpiring) {
  return liveAccess(psd[PSD_ACCESS], psd[PSD_ACCESS_EXPIRES], allowExpiring);
}

// A memory rotation only counts while the row still holds the token it replaced;
// any other row value means the credential was replaced and memory is stale.
function memoryFor(id, psd) {
  const entry = memoryRotations.get(id);
  if (!entry) return null;
  if (entry.basedOn !== (str(psd[PSD_REFRESH]) ?? null)) {
    memoryRotations.delete(id);
    return null;
  }
  return entry;
}

function leaseFree(lease) {
  if (!str(lease)) return true;
  return num(lease.split(":")[1]) <= deps.now();
}

// ---- parsing ------------------------------------------------------------

function toIso(seconds) {
  const s = num(seconds);
  if (s <= 0) return null;
  const d = new Date(s * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseWindow(w) {
  if (!isObject(w)) return null;
  const used = Math.max(0, num(w.used));
  const remaining = Math.max(0, num(w.remaining));
  const declared = num(w.limit);
  const total = declared > 0 ? declared : used + remaining;
  return {
    used,
    total,
    remaining: total > 0 ? Math.max(0, total - used) : remaining,
    remainingPercentage: total > 0 ? Math.max(0, Math.min(100, ((total - used) / total) * 100)) : 0,
    resetAt: toIso(w.reset_at),
    unlimited: false
  };
}

function pickAccountPool(pools) {
  const list = (Array.isArray(pools) ? pools : isObject(pools) ? Object.values(pools) : []).filter(isObject);
  const pool = list.find((p) => p.pool_type === "default");
  if (pool) return pool;
  // Dedicated pools cover one model each; a lone untyped pool is the legacy shape.
  const untyped = list.filter((p) => !p.pool_type);
  return untyped.length === 1 ? untyped[0] : null;
}

/** Map the console pool-usage payload to DurinDoor's usage shape. */
export function parseSensenovaPoolUsage(payload) {
  if (!isObject(payload)) return null;
  const pool = pickAccountPool(payload.pools);
  if (!pool) return null;
  const quotas = {};
  const w5 = parseWindow(pool.window_5h);
  const w7 = parseWindow(pool.window_7d);
  if (w5) quotas["5h"] = w5;
  if (w7) quotas["7d"] = w7;
  if (!w5 && !w7) return null;
  const usage = { plan: payload.plan?.name || payload.plan?.id || PLAN, quotas };
  if (Object.values(quotas).some((q) => q.total > 0 && q.used >= q.total)) usage.limitReached = true;
  return usage;
}

// ---- token exchange -------------------------------------------------------

async function exchange(refreshToken, proxyOptions) {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: deps.clientId() });
  const res = await deps.fetch(SENSENOVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    // A rotating credential must neither follow a redirect nor be replayed by
    // proxy fallback after an ambiguous transport failure.
    redirect: "error",
    noTransportReplay: true,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, proxyOptions);
  if (!res?.ok) {
    // Permission, client configuration and missing endpoints do not prove that
    // the refresh token is invalid. Even OAuth 400 needs explicit invalid_grant.
    const error = res?.status === 400 ? await res.json().catch(() => null) : null;
    return { failure: res?.status === 401 || error?.error === "invalid_grant" ? "auth" : "transient" };
  }
  const data = await res.json().catch(() => null);
  if (!str(data?.access_token)) return { failure: "transient" };
  const ttl = num(data.expires_in) > 0 ? num(data.expires_in) : DEFAULT_ACCESS_TTL_SECONDS;
  return { accessToken: data.access_token, refreshToken: str(data.refresh_token), expiresAt: deps.now() + ttl * 1000 };
}

async function releaseLease(id, rowToken, lease) {
  try {
    await deps.swap(id, { [PSD_REFRESH]: rowToken, [PSD_LEASE]: lease }, { [PSD_LEASE]: null });
  } catch {
    // The lease expires on its own.
  }
}

async function refreshOnce(id, proxyOptions, rejected) {
  const row = await deps.readConnection(id);
  if (!row) return { failure: "auth" };
  const psd = psdOf(row);
  // Another process may have refreshed already.
  const fresh = rowAccess(psd);
  if (fresh && fresh !== rejected) return { accessToken: fresh };
  const rowToken = str(psd[PSD_REFRESH]);
  const mem = memoryFor(id, psd);
  if (mem && mem.accessToken !== rejected && liveAccess(mem.accessToken, mem.expiresAt)) return { accessToken: mem.accessToken };
  const spend = mem?.refreshToken ?? rowToken;
  if (!spend) return { failure: "auth" };

  // Cross-process claim: only the lease holder may spend the stored token.
  if (!leaseFree(psd[PSD_LEASE])) return { failure: "busy" };
  const lease = `${Math.random().toString(36).slice(2)}:${deps.now() + LEASE_MS}`;
  const claim = await deps.swap(id, { [PSD_REFRESH]: rowToken, [PSD_LEASE]: psd[PSD_LEASE] ?? null }, { [PSD_LEASE]: lease });
  if (!claim?.applied) return { failure: "busy" };

  let result;
  try {
    result = await exchange(spend, proxyOptions);
  } catch {
    result = { failure: "transient" };
  }
  if (result.failure) {
    // Keep the last good token: nothing is rotated or cleared on failure.
    await releaseLease(id, rowToken, lease);
    return result;
  }

  const nextRefresh = result.refreshToken ?? spend;
  const next = { [PSD_REFRESH]: nextRefresh, [PSD_ACCESS]: result.accessToken, [PSD_ACCESS_EXPIRES]: result.expiresAt, [PSD_LEASE]: null };
  let written;
  try {
    written = await deps.swap(id, { [PSD_REFRESH]: rowToken, [PSD_LEASE]: lease }, next);
  } catch {
    written = null;
  }
  if (written?.applied) {
    memoryRotations.delete(id);
    return { accessToken: result.accessToken };
  }
  if (written && !written.applied) {
    // The stored credential was replaced meanwhile (operator edit): their value wins,
    // and this session belongs to the previous credential.
    memoryRotations.delete(id);
    return { failure: "replaced" };
  }
  // Write failed (locked/read-only DB): the consumed token is dead, so the rotation
  // must survive in memory and be retried on the next refresh.
  memoryRotations.set(id, { basedOn: rowToken, refreshToken: nextRefresh, accessToken: result.accessToken, expiresAt: result.expiresAt });
  return { accessToken: result.accessToken };
}

/** Single-flight refresh per connection and stored token. */
export function refreshSensenovaSession(id, psd, proxyOptions, rejected = null) {
  const key = str(psd?.[PSD_REFRESH]) ?? "";
  const pending = inflight.get(id);
  if (pending && pending.key === key) return pending.promise;
  const promise = refreshOnce(id, proxyOptions, rejected).finally(() => {
    if (inflight.get(id)?.promise === promise) inflight.delete(id);
  });
  inflight.set(id, { key, promise });
  return promise;
}

// ---- usage ----------------------------------------------------------------

async function readPool(accessToken, proxyOptions) {
  const res = await deps.fetch(SENSENOVA_POOL_USAGE_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", Referer: "https://platform.sensenova.cn/console" },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, proxyOptions);
  if (res?.ok) return { payload: await res.json().catch(() => null) };
  // Only 401 means the session died; 403 is a plan/permission problem and must not rotate.
  return { status: res?.status === 401 ? "unauthorized" : res?.status === 403 ? "forbidden" : "unavailable" };
}

const MESSAGES = {
  auth: "SenseNova console session rejected; update the console refresh token.",
  replaced: "SenseNova console credential changed during refresh; retry shortly.",
  busy: "SenseNova console session refresh in progress; retry shortly.",
  forbidden: "The SenseNova plan does not allow reading this balance.",
  transient: "SenseNova console unreachable right now; the balance will retry shortly."
};

export async function getSensenovaUsage(connection, proxyOptions = null) {
  const id = str(connection?.id);
  const psd = psdOf(connection);
  if (!id || (!str(psd[PSD_REFRESH]) && !str(psd[PSD_ACCESS]))) {
    return { message: "SenseNova Token Plan balance needs a console refresh token (providerSpecificData.sensenovaRefreshToken)." };
  }
  try {
    const mem = memoryFor(id, psd);
    let access = (mem && liveAccess(mem.accessToken, mem.expiresAt)) || rowAccess(psd);
    let refreshed = false;
    if (!access) {
      const session = await refreshSensenovaSession(id, psd, proxyOptions);
      refreshed = Boolean(session.accessToken);
      // Failed refresh: an unexpired stored session is still the last good token.
      access = session.accessToken || (mem && liveAccess(mem.accessToken, mem.expiresAt, true)) || rowAccess(psd, true);
      if (!access) return { plan: PLAN, message: MESSAGES[session.failure] || MESSAGES.transient };
    }
    let read = await readPool(access, proxyOptions);
    if (read.status === "unauthorized" && !refreshed) {
      const session = await refreshSensenovaSession(id, psd, proxyOptions, access);
      if (!session.accessToken) return { plan: PLAN, message: MESSAGES[session.failure] || MESSAGES.auth };
      read = await readPool(session.accessToken, proxyOptions);
    }
    if (read.status) return { plan: PLAN, message: MESSAGES[read.status === "unauthorized" ? "auth" : read.status] || MESSAGES.transient };
    return parseSensenovaPoolUsage(read.payload) || { plan: PLAN, message: "SenseNova console reported no Token Plan balance yet." };
  } catch {
    return { plan: PLAN, message: MESSAGES.transient };
  }
}
