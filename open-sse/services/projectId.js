/**
 * Project ID Service - Fetch and cache real Project IDs from Google Cloud Code API
 *
 *
 * Instead of generating random project IDs (e.g. "useful-spark-a1b2c"),
 * this service fetches the real Project ID bound to the authenticated user's account.
 * This significantly reduces the risk of being flagged by Google's anti-abuse systems.
 */

import { CLOUD_CODE_API, LOAD_CODE_ASSIST_HEADERS, ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS, LOAD_CODE_ASSIST_METADATA } from "../config/appConstants.js";
import { proxyRouteFingerprint } from "./tokenRefresh/dedup.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { readBoundedResponseText, sanitizeErrorMessage } from "../utils/error.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const PROJECT_RESPONSE_MAX_BYTES = 256 * 1024;
const PROJECT_RESPONSE_TIMEOUT_MS = 30_000;

// ─── Cache ────────────────────────────────────────────────────────────────────
// connectionId -> { projectId: string, fetchedAt: number }
const projectIdCache = new Map();

/** How long a cached project ID is considered fresh (1 hour). */
const CACHE_TTL_MS = 60 * 60 * 1000;

// ─── Pending-fetch deduplication ─────────────────────────────────────────────
// connectionId -> { promise: Promise<string|null>, controller: AbortController, startedAt: number }
const pendingFetches = new Map();

/** Abort and evict a pending fetch that has been running longer than this (2 min). */
const PENDING_TTL_MS = 2 * 60 * 1000;

// ─── Periodic cleanup ────────────────────────────────────────────────────────
/** How often the background sweep runs (10 min). */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let _cleanupTimer = null;

/** Run one sweep immediately: evict stale cache entries and abort orphaned pending fetches. */
export function cleanupNow() {
  const now = Date.now();

  for (const [id, entry] of projectIdCache) {
    if (!entry || now - entry.fetchedAt >= CACHE_TTL_MS) {
      projectIdCache.delete(id);
    }
  }

  for (const [id, item] of pendingFetches) {
    if (!item || !isNumber(item.startedAt)) {
      pendingFetches.delete(id);
      continue;
    }
    if (now - item.startedAt > PENDING_TTL_MS) {
      try {item.controller.abort();} catch (_) {/* ignore */}
      pendingFetches.delete(id);
    }
  }
}

/** Start the periodic background cleanup (idempotent). Called automatically on module load. */
export function startCacheCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    try {cleanupNow();} catch (e) {
      console.warn("[ProjectId] cleanup sweep error:", sanitizeErrorMessage(e?.message ?? e));
    }
  }, CLEANUP_INTERVAL_MS);
  // Unref so the timer doesn't prevent Node from exiting when it is otherwise idle
  _cleanupTimer?.unref?.();
}

/** Stop the periodic background cleanup (e.g. during graceful shutdown). */
export function stopCacheCleanup() {
  if (!_cleanupTimer) return;
  clearInterval(_cleanupTimer);
  _cleanupTimer = null;
}

// Start automatically when the module is first imported
startCacheCleanup();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the Project ID for a connection, with caching.
 * Returns null on failure (callers should fall back to random generation).
 *
 * @param {string} connectionId - The connection identifier for cache keying
 * @param {string} accessToken  - Valid OAuth access token
 * @returns {Promise<string|null>} Real project ID or null
 */
function projectAbortError(reason) {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("Project discovery aborted", "AbortError");
}

function subscribeToPending(entry, signal) {
  if (signal?.aborted) return Promise.reject(projectAbortError(signal.reason));
  const subscriber = {};
  entry.subscribers.add(subscriber);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      entry.subscribers.delete(subscriber);
      callback(value);
    };
    const onAbort = () => {
      finish(reject, projectAbortError(signal?.reason));
      if (entry.subscribers.size === 0 && !entry.settled) {
        entry.controller.abort(projectAbortError(signal?.reason));
      }
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    entry.promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

export async function getProjectIdForConnection(connectionId, accessToken, proxyOptions = null, signal = null, provider = null) {
  if (!connectionId || !accessToken) return null;
  if (signal?.aborted) throw projectAbortError(signal.reason);

  // Return cached value if still fresh
  const cached = projectIdCache.get(connectionId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.projectId;
  }

  // Deduplicate concurrent fetches for the same connection
  const pendingKey = `${connectionId}:${proxyRouteFingerprint(proxyOptions)}`;
  const pending = pendingFetches.get(pendingKey);
  if (pending?.controller?.signal?.aborted) {
    pendingFetches.delete(pendingKey);
  } else if (pending) {
    return subscribeToPending(pending, signal);
  }

  // Each fetch gets its own AbortController so it can be canceled via removeConnection()
  const controller = new AbortController();

  const entry = { promise: null, controller, startedAt: Date.now(), subscribers: new Set(), settled: false };
  entry.promise = (async () => {
    try {
      const projectId = await fetchProjectId(accessToken, controller.signal, proxyOptions, provider);
      if (projectId && !controller.signal.aborted) {
        projectIdCache.set(connectionId, { projectId, fetchedAt: Date.now() });
        return projectId;
      }
      console.warn("[ProjectId] could not fetch projectId for connection", connectionId.slice(0, 8));
      return null;
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.warn(`[ProjectId] Error fetching project ID: ${sanitizeErrorMessage(error?.message || error)}`);
      }
      return null;
    } finally {
      entry.settled = true;
      if (pendingFetches.get(pendingKey) === entry) pendingFetches.delete(pendingKey);
    }
  })();

  pendingFetches.set(pendingKey, entry);
  return subscribeToPending(entry, signal);
}


/**
 * Fully remove a connection: abort any in-flight fetch and delete its cached project ID.
 * Wire this into your connection close / disconnect lifecycle events to prevent memory leaks.
 *
 * @param {string} connectionId
 */
export function removeConnection(connectionId) {
  if (!connectionId) return;
  projectIdCache.delete(connectionId);
  for (const [key, pending] of pendingFetches) {
    if (!key.startsWith(`${connectionId}:`)) continue;
    try {pending.controller.abort();} catch (_) {/* ignore */}
    pendingFetches.delete(key);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch project ID via loadCodeAssist endpoint.
 * Falls back to onboardUser when loadCodeAssist returns no project.
 *
 * @param {string}      accessToken
 * @param {AbortSignal} signal
 * @returns {Promise<string|null>}
 */
async function fetchProjectId(accessToken, signal, proxyOptions, provider = null) {
  // Antigravity must not carry the Gemini CLI's Google-client fingerprints:
  // the backend refuses to provision a project when it sees them.
  const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
  const response = await proxyAwareFetch(CLOUD_CODE_API.loadCodeAssist, {
    method: "POST",
    headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
    body: JSON.stringify({ metadata: LOAD_CODE_ASSIST_METADATA }),
    signal
  }, proxyOptions);

  const responseText = await readBoundedResponseText(response, {
    signal,
    maxBytes: PROJECT_RESPONSE_MAX_BYTES,
    timeoutMs: PROJECT_RESPONSE_TIMEOUT_MS
  });
  if (!response.ok) {
    const errorText = responseText;
    throw new Error(`loadCodeAssist failed: HTTP ${response.status} ${sanitizeErrorMessage(errorText)}`);
  }

  const data = JSON.parse(responseText);
  const projectId = extractProjectId(data);
  if (projectId) return projectId;

  // Determine the tier to use for onboarding
  let tierID = "legacy-tier";
  if (Array.isArray(data.allowedTiers)) {
    for (const tier of data.allowedTiers) {
      if (tier && isObject(tier) && tier.isDefault === true) {
        if (tier.id && isString(tier.id) && tier.id.trim()) {
          tierID = tier.id.trim();
          break;
        }
      }
    }
  }

  return onboardUser(accessToken, tierID, signal, proxyOptions, provider);
}

/**
 * Fetch project ID via onboardUser endpoint (polls until done).
 * A done response without a usable project ID is terminal because retrying the
 * same completed onboarding operation cannot provision the account.
 *
 * @param {string}      accessToken
 * @param {string}      tierID
 * @param {AbortSignal} externalSignal  – propagated from the connection's AbortController
 * @returns {Promise<string|null>}
 */
async function onboardUser(accessToken, tierID, externalSignal, proxyOptions, provider = null) {
  console.log(`[ProjectId] Onboarding user with tier: ${tierID}`);

  const reqBody = { tierId: tierID, metadata: LOAD_CODE_ASSIST_METADATA };
  // Same fingerprint scoping as loadCodeAssist above.
  const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Bail out immediately if the connection was removed
    if (externalSignal?.aborted) return null;

    // Per-attempt timeout controller; forwards external abort as well
    const localCtrl = new AbortController();
    const timeoutId = setTimeout(() => localCtrl.abort(), 30_000);
    const forwardAbort = () => localCtrl.abort();
    externalSignal?.addEventListener("abort", forwardAbort);

    try {
      const response = await proxyAwareFetch(CLOUD_CODE_API.onboardUser, {
        method: "POST",
        headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
        body: JSON.stringify(reqBody),
        signal: localCtrl.signal
      }, proxyOptions);

      const responseText = await readBoundedResponseText(response, {
        signal: localCtrl.signal,
        maxBytes: PROJECT_RESPONSE_MAX_BYTES,
        timeoutMs: PROJECT_RESPONSE_TIMEOUT_MS
      });

      if (!response.ok) {
        const errorText = responseText;
        throw new Error(`onboardUser HTTP ${response.status}: ${sanitizeErrorMessage(errorText)}`);
      }

      const data = JSON.parse(responseText);

      if (data.done === true) {
        const projectId = extractProjectIdFromOnboard(data);
        if (projectId) {
          console.log(`[ProjectId] Successfully onboarded, project ID: ${projectId}`);
          return projectId;
        }
        console.warn("[ProjectId] onboardUser finished without a project ID (account not provisioned)");
        return null;
      }

      // Server not done yet – wait and retry
      console.log(`[ProjectId] Onboard attempt ${attempt}/${MAX_ATTEMPTS}: not done yet, waiting...`);
      await waitForProjectRetry(2000, externalSignal);

    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        console.warn(`[ProjectId] onboardUser attempt ${attempt} aborted (timeout or connection removed)`);
        if (externalSignal?.aborted) return null; // connection gone – stop retrying
        continue;
      }
      if (attempt === MAX_ATTEMPTS) {
        console.warn(
          `[ProjectId] onboardUser failed after ${MAX_ATTEMPTS} attempts: ${sanitizeErrorMessage(error?.message || error)}`
        );
        return null;
      }
      // Continue to next attempt instead of throwing (which would skip remaining retries)
      console.warn(
        `[ProjectId] onboardUser attempt ${attempt} failed: ${sanitizeErrorMessage(error?.message || error)}, retrying...`
      );
      await waitForProjectRetry(2000, externalSignal);
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  return null;
}

function waitForProjectRetry(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(projectAbortError(signal.reason));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(resolve), delayMs);
    const onAbort = () => finish(reject, projectAbortError(signal?.reason));
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      callback(value);
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * Extract project ID from loadCodeAssist response.
 */
function extractProjectId(data) {
  if (!data) return null;

  if (isString(data.cloudaicompanionProject)) {
    const id = data.cloudaicompanionProject.trim();
    if (id) return id;
  }

  if (data.cloudaicompanionProject && isObject(data.cloudaicompanionProject)) {
    const id = data.cloudaicompanionProject.id;
    if (isString(id) && id.trim()) return id.trim();
  }

  return null;
}

/**
 * Extract project ID from onboardUser response.
 */
function extractProjectIdFromOnboard(data) {
  if (!data?.response) return null;

  const project = data.response.cloudaicompanionProject;

  if (isString(project)) {
    const id = project.trim();
    if (id) return id;
  }

  if (project && isObject(project)) {
    const id = project.id;
    if (isString(id) && id.trim()) return id.trim();
  }

  return null;
}