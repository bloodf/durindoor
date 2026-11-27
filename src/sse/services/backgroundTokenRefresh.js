// Background proactive OAuth token refresh — independent of inbound requests.
// Fail-open everywhere: tick errors and per-connection failures never kill the interval.

import * as log from "../utils/logger.js";
import { getRefreshLeadMs } from "open-sse/services/tokenRefresh.js";
import { getCredentialExpiryMs } from "open-sse/services/oauthCredentialManager.js";
import { refreshCapabilities } from "open-sse/services/tokenRefresh/capabilities.js";
import { trackRefreshPersistence } from "open-sse/services/refreshSerializer.js";

/** Refresh when expiry is within 30 minutes (or the provider on-request lead, whichever larger). */
import { isBrowser } from "../../shared/utils/typeChecks.js";
export const BACKGROUND_REFRESH_LEAD_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

let started = false;
let intervalHandle = null;
let initialTimeoutHandle = null;
let tickRunning = false;
// Set by stop: a running tick finishes its current account and starts no other.
let stopRequested = false;

function isTruthyEnv(value) {
  if (value == null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isNonServerRuntime() {
  if (isBrowser()) return true;
  const phase = process.env.NEXT_PHASE || "";
  if (
  phase === "phase-production-build" ||
  phase === "phase-export" ||
  phase === "phase-static")
  {
    return true;
  }
  // Next.js build / static generation markers
  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

/**
 * Pure selection: OAuth connections with a refreshToken whose access token
 * expires within max(provider on-request lead, BACKGROUND_REFRESH_LEAD_MS).
 *
 * @param {Array<object>} connections
 * @param {number} [nowMs]
 * @returns {Array<object>}
 */
export function selectConnectionsNeedingRefresh(connections, nowMs = Date.now()) {
  if (!Array.isArray(connections) || connections.length === 0) return [];

  const out = [];
  for (const conn of connections) {
    if (!conn) continue;

    const authType = String(conn.authType || "").toLowerCase().replace(/_/g, "");
    if (authType !== "oauth") continue;
    if (!conn.refreshToken) continue;

    const expiresAtMs = getCredentialExpiryMs(conn);
    if (expiresAtMs === null) continue;

    const providerLead = getRefreshLeadMs(conn.provider, conn.providerSpecificData);
    const leadMs = Math.max(
      Number.isFinite(providerLead) ? providerLead : 0,
      BACKGROUND_REFRESH_LEAD_MS
    );

    if (expiresAtMs - nowMs < leadMs) {
      out.push(conn);
    }
  }
  return out;
}

async function loadActiveConnections() {
  // Dynamic import avoids circular load with db / app graph at module eval time.
  const { getProviderConnections } = await import("../../lib/db/repos/connectionsRepo.js");
  return getProviderConnections({ isActive: true });
}

async function loadConnectionById(id) {
  const { getProviderConnectionById } = await import("../../lib/db/repos/connectionsRepo.js");
  return getProviderConnectionById(id);
}

/**
 * True when a live row's refresh credentials differ from the tick snapshot.
 * A concurrent request-path refresh rotates these fields; reusing the snapshot
 * refresh token would trip Auth0/Claude family revocation (durindoor#2280).
 *
 * @param {object} snapshot
 * @param {object|null|undefined} fresh
 * @returns {boolean}
 */
export function refreshCredentialsChangedSinceSnapshot(snapshot, fresh) {
  if (!fresh || !snapshot) return false;
  if (fresh.refreshToken !== snapshot.refreshToken) return true;
  return (fresh.lastRefreshAt ?? null) !== (snapshot.lastRefreshAt ?? null);
}

async function refreshOne(connection) {
  const { checkAndRefreshToken } = await import("./tokenRefresh.js");
  // This fork's third parameter is proxyOptions; force is the fourth.
  return checkAndRefreshToken(connection.provider, connection, null, { force: true });
}

/**
 * One scheduler tick. Fail-open at top level and per connection.
 * @param {{
 *   loadConnections?: Function,
 *   refreshConnection?: Function,
 *   getConnectionById?: Function,
 *   sleep?: Function,
 * }} [deps]
 */
export async function runBackgroundTokenRefreshTick(deps = {}) {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const load = deps.loadConnections || loadActiveConnections;
    const refresh = deps.refreshConnection || refreshOne;
    const sleep = deps.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
    // Re-read before each forced refresh unless a test injected refreshConnection
    // without a getConnectionById (those suites assert orchestration only).
    const getById =
      deps.getConnectionById ||
      (!deps.refreshConnection ? loadConnectionById : null);

    const connections = await load();
    const due = selectConnectionsNeedingRefresh(connections, Date.now());

    if (due.length === 0) return;

    const baseSensitiveDelay = Number(process.env.BG_REFRESH_GOOGLE_DELAY_MS) || 12_000;
    const baseNormalDelay = Number(process.env.BG_REFRESH_DELAY_MS) || 1_500;

    for (let i = 0; i < due.length; i++) {
      if (stopRequested) break;
      const snapshot = due[i];
      let conn = snapshot;
      try {
        if (getById) {
          const fresh = await getById(snapshot.id);
          // Missing row: keep the snapshot (integration fixtures have no DB row).
          // Changed refreshToken/lastRefreshAt: skip — another path already rotated.
          if (refreshCredentialsChangedSinceSnapshot(snapshot, fresh)) {
            log.info("BG_TOKEN_REFRESH", "Skipping stale snapshot; credentials already rotated", {
              id: snapshot.id,
              email: snapshot.email || snapshot.name || snapshot.id,
              provider: snapshot.provider
            });
          } else {
            if (fresh) conn = fresh;
            if (stopRequested) break;
            await trackRefreshPersistence(refresh(conn));
            log.info("BG_TOKEN_REFRESH", "Connection refresh finished", {
              id: conn.id,
              email: conn.email || conn.name || conn.id,
              provider: conn.provider
            });
          }
        } else {
          await trackRefreshPersistence(refresh(conn));
          log.info("BG_TOKEN_REFRESH", "Connection refresh finished", {
            id: conn.id,
            email: conn.email || conn.name || conn.id,
            provider: conn.provider
          });
        }
      } catch (err) {
        log.warn("BG_TOKEN_REFRESH", "Connection refresh failed (swallowed)", {
          id: conn?.id,
          email: conn?.email || conn?.name || conn?.id,
          provider: conn?.provider,
          error: err?.message ?? String(err)
        });
      }

      // Sequential delay between accounts to prevent bursting upstream providers (especially Google Cloud)
      if (i < due.length - 1 && !stopRequested) {
        const isSensitive = refreshCapabilities(snapshot.provider).googleAntiBurst === true;
        const baseDelay = isSensitive ? baseSensitiveDelay : baseNormalDelay;
        const jitter = isSensitive ? Math.floor(Math.random() * 4000) : 200;
        await sleep(baseDelay + jitter);
      }
    }
  } catch (err) {
    log.warn("BG_TOKEN_REFRESH", "Tick failed (swallowed)", {
      error: err?.message ?? String(err)
    });
  } finally {
    tickRunning = false;
  }
}

/**
 * Start the background interval. Safe to call multiple times (no-op if already started).
 * @param {{ intervalMs?: number }} [opts]
 * @returns {boolean} true if started this call
 */
export function startBackgroundTokenRefresh({ intervalMs } = {}) {
  if (started) return false;
  if (isTruthyEnv(process.env.DISABLE_BACKGROUND_TOKEN_REFRESH)) return false;
  if (isNonServerRuntime()) return false;

  started = true;
  stopRequested = false;
  const period = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;

  const safeTick = () => {
    runBackgroundTokenRefreshTick().catch((err) => {
      log.warn("BG_TOKEN_REFRESH", "Unhandled tick rejection (swallowed)", {
        error: err?.message ?? String(err)
      });
    });
  };

  // First pass soon after boot so idle connections don't wait a full interval.
  initialTimeoutHandle = setTimeout(safeTick, INITIAL_DELAY_MS);
  if (initialTimeoutHandle.unref) initialTimeoutHandle.unref();

  intervalHandle = setInterval(safeTick, period);
  if (intervalHandle.unref) intervalHandle.unref();

  return true;
}

export function stopBackgroundTokenRefresh() {
  stopRequested = true;
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (started) {
    started = false;
  }
}
