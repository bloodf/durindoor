// port(omniroute): per-connection upstream timeout tier (OmniRoute fdeac496e,
// #10885, adapted). DurinDoor has no model/provider timeout registry, so this
// only resolves the connection-level override; callers fall back to their own
// existing default (STREAM_STALL_TIMEOUT_MS / RESPONSE_BODY_TIMEOUT_MS) when
// this returns undefined.

import { isNumber, isObject } from "@/shared/utils/typeChecks";

/** 24h — operator cap, anti-DoS. */
export const MAX_CONNECTION_TIMEOUT_MS = 86_400_000;

/**
 * Reads `providerSpecificData.timeoutMs`, bounded to 1..MAX_CONNECTION_TIMEOUT_MS.
 * @param {unknown} providerSpecificData
 * @returns {number|undefined} floored ms, or undefined when absent/invalid.
 */
export function resolveConnectionTimeoutMs(providerSpecificData) {
  const timeoutMs = providerSpecificData !== null && isObject(providerSpecificData) ?
  providerSpecificData.timeoutMs :
  undefined;
  if (!isNumber(timeoutMs) || !Number.isFinite(timeoutMs)) return undefined;
  const floored = Math.floor(timeoutMs);
  if (floored < 1 || floored > MAX_CONNECTION_TIMEOUT_MS) return undefined;
  return floored;
}
