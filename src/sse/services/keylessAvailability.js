import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { getApiKeyProviderConnectionIds, getProviderConnections, getSettings } from "@/lib/localDb";
import { guardedProbeFetch } from "open-sse/utils/outboundUrlGuard.js";
import { resolveLocalWhisperHost } from "open-sse/config/providers.js";
import { resolveFirecrawlBaseUrl } from "open-sse/handlers/fetch/index.js";
import { fetchLocalDeviceVoices } from "open-sse/handlers/ttsProviders/localDevice.js";
import { isString } from "@/shared/utils/typeChecks.js";

/**
 * "Installed and working" check for keyless providers, used by media routes.
 *
 * A keyless provider whose requests go to a server URL counts only while the
 * URL that this request would call answers: the probe uses the same outbound
 * guard (including the resolved-address check) and a short timeout, so a
 * blocked, refused, or silent host is "not working" and never slows the route.
 * `local-device` counts only when the OS voice list loads. Keyless providers
 * with no server URL (edge-tts, google-tts libraries) count as working.
 *
 * Which URL: an unrestricted request uses the first active connection. Local
 * Whisper calls that connection's host (its default when none is saved);
 * self-hosted Firecrawl calls a valid self-hosted dashboard setting, then the
 * connection's host, then FIRECRAWL_BASE_URL, then its default. For an API key scoped to provider accounts, credential selection is
 * fill-first by priority, so the first active connection that key may use is
 * the one probed. Results are cached per URL for PROBE_TTL_MS.
 */
const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 1500;
const MEDIA_CONFIG_KEYS = ["ttsConfig", "sttConfig", "searchConfig", "fetchConfig", "videoConfig", "musicConfig", "imageConfig", "embeddingConfig"];
const CONNECTION_HOST_PROVIDERS = new Set(["local-whisper", "firecrawl_custom"]);

/** @type {Map<string, { expiresAt: number, working: Promise<boolean> }>} */
const cache = new Map();

export function clearKeylessAvailabilityCache() {
  cache.clear();
}

function registryServiceUrl(provider) {
  for (const key of MEDIA_CONFIG_KEYS) {
    const url = provider?.[key]?.baseUrl;
    if (isString(url) && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

/**
 * The URL this request would call. Unscoped: resolved from the first active
 * connection (the default host when none is saved). A key scoped to
 * provider accounts: the host of its first allowed active connection, which is
 * the one credential selection picks (getProviderConnections sorts by priority).
 * An empty list means the key cannot use this provider.
 */
async function requestUrlsFor(providerId, apiKeyId) {
  if (!CONNECTION_HOST_PROVIDERS.has(providerId)) {
    const url = registryServiceUrl(AI_PROVIDERS[providerId]);
    return url ? [url] : null;
  }
  const settings = providerId === "firecrawl_custom" ? await getSettings().catch(() => ({})) : null;
  const resolve = (connection) => {
    try {
      return providerId === "local-whisper"
        ? resolveLocalWhisperHost(connection)
        : resolveFirecrawlBaseUrl(providerId, { firecrawlBaseUrl: settings?.firecrawlBaseUrl || "" }, connection);
    } catch {
      return null; // e.g. an invalid self-hosted Firecrawl URL
    }
  };
  const allowedIds = apiKeyId ? await getApiKeyProviderConnectionIds(apiKeyId).catch(() => []) : [];
  const connections = await getProviderConnections({ provider: providerId, isActive: true }).catch(() => []);
  // Unscoped requests use the first active connection when one exists
  // (auth.js NO_AUTH_CONNECTION_HOST_PROVIDERS); resolve applies each provider's host rules.
  if (allowedIds.length === 0) return [resolve(connections[0] || null)].filter(Boolean);
  // ponytail: ignores peak-hour/RPD gating that could skip the first row; mirror auth.js selection if that matters.
  const selected = connections.find((c) => allowedIds.includes(c.id));
  return selected ? [resolve(selected)].filter(Boolean) : [];
}

/** Any HTTP answer within the timeout means up; blocked, refused or silent means not. */
async function answers(url, fetchImpl) {
  try {
    await fetchImpl(new URL(url).origin, { method: "GET", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

function cached(key, now, compute) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.working;
  const working = compute();
  cache.set(key, { expiresAt: now + PROBE_TTL_MS, working });
  return working;
}

/**
 * @param {string} providerId
 * @param {{ apiKeyId?: string|null, fetchImpl?: Function, now?: number }} [options]
 * @returns {Promise<boolean>} true for keyed providers (their connection proves setup)
 */
export async function isKeylessProviderWorking(providerId, { apiKeyId = null, fetchImpl = guardedProbeFetch, now = Date.now() } = {}) {
  if (AI_PROVIDERS[providerId]?.noAuth !== true) return true;
  if (providerId === "local-device") {
    return cached("local-device", now, async () => {
      const voices = await fetchLocalDeviceVoices().catch(() => []);
      return Array.isArray(voices) && voices.length > 0;
    });
  }
  const urls = await requestUrlsFor(providerId, apiKeyId);
  if (urls === null) return true; // no server URL (a keyless library)
  const results = await Promise.all(urls.map((url) => cached(url, now, () => answers(url, fetchImpl))));
  return results.some(Boolean);
}
