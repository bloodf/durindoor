import {
  CODEX_SSE_PEEK_TIMEOUT_MS,
  PROVIDER_BODY_TIMEOUT_MS,
  STREAM_FIRST_CHUNK_TIMEOUT_MS,
  STREAM_STALL_TIMEOUT_MS,
} from "./runtimeConfig.js";

export const QUOTA_SELECTION_DEFAULTS = Object.freeze({
  routingFloorEnabled: false,
  routingFloorRatio: 0.02,
  lowRatio: 0.20,
  routingFloorEpsilon: 1e-9,
  starvationMs: 5 * 60 * 1000,
  heartbeatMs: 30 * 1000,
  leaseMs: Math.max(
    CODEX_SSE_PEEK_TIMEOUT_MS,
    STREAM_STALL_TIMEOUT_MS,
    STREAM_FIRST_CHUNK_TIMEOUT_MS,
    PROVIDER_BODY_TIMEOUT_MS,
  ) + 60 * 1000,
  maxLeaseMs: 24 * 60 * 60 * 1000,
  terminalRetentionMs: 24 * 60 * 60 * 1000,
  maxItems: 16,
});

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function ratioOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

function scopedConfig(config, key) {
  const value = config?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * Resolve the optional routing floor without conflating it with hard capacity.
 * Precedence is connection/window, provider/window, then global settings.
 */
export function resolveQuotaRoutingFloor(config = {}, {
  connectionId,
  provider,
  dimensionKey,
} = {}) {
  const connection = scopedConfig(scopedConfig(config, "connections"), connectionId);
  const providerConfig = scopedConfig(scopedConfig(config, "providers"), provider);
  const connectionWindow = scopedConfig(scopedConfig(connection, "dimensions"), dimensionKey);
  const providerWindow = scopedConfig(scopedConfig(providerConfig, "dimensions"), dimensionKey);
  const candidates = [connectionWindow, connection, providerWindow, providerConfig, config];

  let enabled = QUOTA_SELECTION_DEFAULTS.routingFloorEnabled;
  let ratio = QUOTA_SELECTION_DEFAULTS.routingFloorRatio;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate.routingFloorEnabled === "boolean") {
      enabled = booleanOr(candidate.routingFloorEnabled, enabled);
      break;
    }
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate.routingFloorRatio === "number"
        && Number.isFinite(candidate.routingFloorRatio)
        && candidate.routingFloorRatio >= 0
        && candidate.routingFloorRatio <= 1) {
      ratio = ratioOr(candidate.routingFloorRatio, ratio);
      break;
    }
  }
  return { enabled, ratio };
}

export function resolveQuotaLeaseMs(value) {
  return Number.isSafeInteger(value)
    && value >= QUOTA_SELECTION_DEFAULTS.heartbeatMs * 2
    && value <= QUOTA_SELECTION_DEFAULTS.maxLeaseMs
    ? value
    : QUOTA_SELECTION_DEFAULTS.leaseMs;
}
