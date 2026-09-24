import { getProviderConnections } from "@/lib/localDb";
import {
  LAYA_PROVIDER_ID,
  LAYA_DEFAULT_HOST,
  LAYA_TIMEOUT_MS,
  LAYA_MIN_CONFIDENCE,
  resolveLayaHost,
  resolveLayaCheckpoint
} from "open-sse/config/laya.js";
import { JEV_ENDPOINT_PATH } from "open-sse/config/jev.js";
import { assertOutboundUrlAllowed, guardedProbeFetch } from "open-sse/utils/outboundUrlGuard.js";

/**
 * Classifier backend for smart/task combo routing, in order:
 *
 * 1. An active Laya connection the user added (first by priority).
 * 2. A keyless `laya-serve` already running at the default local host,
 *    found by probing; the user installed it, so it is used without setup.
 * 3. null: the classifier keeps its Jev env configuration
 *    (TYPESAFE_API_KEY / TYPESAFE_API_BASE), or the heuristic without one.
 *
 * Laya speaks Jev's `/v1/systemone` protocol, runs locally, and costs nothing.
 */
const DETECT_TTL_MS = 30_000;
const DETECT_TIMEOUT_MS = 1000;

/** @type {{ expiresAt: number, usable: Promise<boolean> } | null} */
let detected = null;

export function clearLayaDetection() {
  detected = null;
}

// The classifier POSTs the user's turn to this host, so it goes through the
// same outbound guard as provider requests, including the resolved-address
// check on the socket.
const guardedFetch = async (url, init) => guardedProbeFetch(url, init);

function layaBackend(baseUrl, connection = null) {
  return {
    source: "laya",
    baseUrl,
    fetchImpl: guardedFetch,
    apiKey: connection?.apiKey || null,
    apiKeyOptional: true,
    model: resolveLayaCheckpoint(connection),
    timeoutMs: LAYA_TIMEOUT_MS,
    minConfidence: LAYA_MIN_CONFIDENCE,
    inputPricePerMTok: 0,
    outputPricePerMTok: 0
  };
}

/**
 * An empty /v1/systemone body gets 400 from a keyless server and 401 from one
 * started with LAYA_API_KEY. Only the keyless one is usable without a
 * connection; a keyed one would fail every call and shadow Jev.
 */
async function probeLocalLaya(fetchImpl) {
  try {
    const res = await fetchImpl(`${LAYA_DEFAULT_HOST}${JEV_ENDPOINT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      // Only a direct 400 is Laya; a redirect is not followed or trusted,
      // matching the classifier, which also refuses redirects.
      redirect: "manual",
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS)
    });
    return res.status === 400;
  } catch {
    return false;
  }
}

function localLayaUsable(fetchImpl, now) {
  if (!detected || detected.expiresAt <= now) {
    detected = { expiresAt: now + DETECT_TTL_MS, usable: probeLocalLaya(fetchImpl) };
  }
  return detected.usable;
}

/**
 * @param {{ fetchImpl?: Function, now?: number }} [options] - injectable for tests
 * @returns {Promise<object|null>} classifyTier overrides, or null
 */
export async function resolveDecisionBackend({ fetchImpl = (...args) => fetch(...args), now = Date.now() } = {}) {
  const [connection] = await getProviderConnections({ provider: LAYA_PROVIDER_ID, isActive: true });
  if (connection) {
    const host = resolveLayaHost(connection);
    try {
      assertOutboundUrlAllowed(host);
    } catch {
      return null; // a blocked host (e.g. cloud metadata) never gets the user's text; Jev runs instead
    }
    return layaBackend(host, connection);
  }
  return (await localLayaUsable(fetchImpl, now)) ? layaBackend(LAYA_DEFAULT_HOST) : null;
}
