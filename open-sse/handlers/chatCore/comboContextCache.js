import { getSettings } from "@/lib/localDb";
import { isObject } from "@/shared/utils/typeChecks.js";

const proxyConfigCache = new Map();
const PROXY_CONFIG_CACHE_TTL_MS = 10_000;

/**
 * Cache provider upstream proxy settings for the hot chat path.
 *
 * DurinDoor stores this operator-only map in settings so the port stays
 * additive: absent config means "native" and never changes routing.
 */
export async function getUpstreamProxyConfigCached(providerId) {
  const cached = proxyConfigCache.get(providerId);
  if (cached && Date.now() - cached.ts < PROXY_CONFIG_CACHE_TTL_MS) return cached;

  let cfg = null;
  try {
    const settings = await getSettings();
    cfg = settings?.upstreamProxyConfig?.[providerId] || null;
  } catch {
    cfg = null;
  }

  const mode = ["native", "cliproxyapi", "fallback"].includes(cfg?.mode) ?
  cfg.mode :
  "native";
  const result = {
    enabled: cfg?.enabled === true,
    mode,
    cliproxyapiModelMapping:
    cfg?.cliproxyapiModelMapping && isObject(cfg.cliproxyapiModelMapping) ?
    cfg.cliproxyapiModelMapping :
    {},
    ts: Date.now()
  };
  proxyConfigCache.set(providerId, result);
  return result;
}

export function clearUpstreamProxyConfigCache(providerId) {
  if (providerId) {
    proxyConfigCache.delete(providerId);
    return;
  }
  proxyConfigCache.clear();
}