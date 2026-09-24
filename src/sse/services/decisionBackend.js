import { getProviderConnections } from "@/lib/localDb";
import {
  LAYA_PROVIDER_ID,
  LAYA_TIMEOUT_MS,
  LAYA_MIN_CONFIDENCE,
  resolveLayaHost,
  resolveLayaCheckpoint
} from "open-sse/config/laya.js";

/**
 * Classifier backend for smart/task combo routing.
 *
 * An active Laya connection (a user-run `laya-serve`) replaces TypeSafe Jev:
 * same `/v1/systemone` protocol, local host, optional key, no spend. With no
 * active Laya connection this returns null and the classifier keeps its Jev
 * env configuration (TYPESAFE_API_KEY / TYPESAFE_API_BASE). The first active
 * connection by priority wins.
 *
 * @returns {Promise<object|null>} classifyTier overrides, or null
 */
export async function resolveDecisionBackend() {
  const [connection] = await getProviderConnections({ provider: LAYA_PROVIDER_ID, isActive: true });
  if (!connection) return null;
  return {
    source: "laya",
    baseUrl: resolveLayaHost(connection),
    apiKey: connection.apiKey || null,
    apiKeyOptional: true,
    model: resolveLayaCheckpoint(connection),
    timeoutMs: LAYA_TIMEOUT_MS,
    minConfidence: LAYA_MIN_CONFIDENCE,
    inputPricePerMTok: 0,
    outputPricePerMTok: 0
  };
}
