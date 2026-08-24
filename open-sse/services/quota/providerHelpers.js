import { requestQuotaJson } from "./transport.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

export function connectionData(connection) {
  const data = connection?.providerSpecificData;
  return data && isObject(data) && !Array.isArray(data) ? data : {};
}

export function connectionCredential(connection, ...keys) {
  const providerData = connectionData(connection);
  for (const key of keys) {
    const value = connection?.[key] ?? providerData[key];
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

export function providerSuccess(config, rows, attemptedAt = null) {
  if (!Array.isArray(rows)) {
    return { outcome: "malformed", sourceId: config.sourceId, retryAt: null, attemptedAt };
  }
  return { outcome: "success", sourceId: config.sourceId, rows, attemptedAt };
}

export function providerFailure(config, result, fallbackOutcome = "provider_error") {
  return {
    outcome: result?.outcome || fallbackOutcome,
    sourceId: config.sourceId,
    attemptedAt: result?.attemptedAt || null,
    retryAt: result?.retryAt || null
  };
}

export function missingCredential(config) {
  return { outcome: "missing", sourceId: config.sourceId, attemptedAt: null, retryAt: null };
}

export function futureResetAt(value, now) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= now ? new Date(timestamp).toISOString() : null;
}

export function createProviderRequest(context) {
  return (url, options = {}) => requestQuotaJson({
    url,
    options,
    fetchImpl: context.fetchImpl,
    proxyOptions: context.proxyOptions,
    signal: context.signal,
    now: context.now,
    timeoutMs: context.timeoutMs,
    maxBytes: context.maxResponseBytes
  });
}