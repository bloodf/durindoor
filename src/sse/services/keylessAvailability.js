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
 * Which URL: an unrestricted request carries no saved connection
 * (buildOptionalNoAuthCredential), so Local Whisper calls its default host and
 * self-hosted Firecrawl the dashboard setting, then FIRECRAWL_BASE_URL, then its
 * default. An API key scoped to provider accounts uses the first active
 * connection it may use. Results are cached per URL for PROBE_TTL_MS.
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

/** The connection a scoped key would use for this provider, or null when unscoped. */
async function scopedConnection(providerId, apiKeyId) {
  if (!apiKeyId) return { connection: null };
  const allowedIds = await getApiKeyProviderConnectionIds(apiKeyId).catch(() => []);
  if (allowedIds.length === 0) return { connection: null };
  const connections = await getProviderConnections({ provider: providerId, isActive: true }).catch(() => []);
  const connection = connections.find((c) => allowedIds.includes(c.id));
  return connection ? { connection } : { denied: true };
}

/** The URL this request would call, `null` when the provider has none, `false` when unusable. */
async function requestUrlFor(providerId, apiKeyId) {
  if (!CONNECTION_HOST_PROVIDERS.has(providerId)) return registryServiceUrl(AI_PROVIDERS[providerId]);
  const { connection, denied } = await scopedConnection(providerId, apiKeyId);
  if (denied) return false; // the key may not use any account of this provider
  try {
    if (providerId === "local-whisper") return resolveLocalWhisperHost(connection);
    const settings = await getSettings().catch(() => ({}));
    return resolveFirecrawlBaseUrl(providerId, { firecrawlBaseUrl: settings?.firecrawlBaseUrl || "" }, connection);
  } catch {
    return false; // e.g. an invalid self-hosted Firecrawl URL
  }
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
  const url = await requestUrlFor(providerId, apiKeyId);
  if (url === false) return false;
  if (!url) return true;
  return cached(url, now, () => answers(url, fetchImpl));
}
