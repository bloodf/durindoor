import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { getProviderConnections, getSettings } from "@/lib/localDb";
import { isPrivateHost, assertOutboundUrlAllowed, guardedProbeFetch } from "open-sse/utils/outboundUrlGuard.js";
import { resolveLocalWhisperHost } from "open-sse/config/providers.js";
import { resolveFirecrawlBaseUrl } from "open-sse/handlers/fetch/index.js";
import { fetchLocalDeviceVoices } from "open-sse/handlers/ttsProviders/localDevice.js";
import { isString } from "@/shared/utils/typeChecks.js";

/**
 * "Installed and working" check for keyless providers, used by media routes.
 *
 * A keyless provider backed by a self-hosted server (a loopback or private URL:
 * Local Whisper, Coqui, Tortoise, SearXNG, self-hosted Firecrawl) counts only
 * while that server answers. `local-device` counts only when the OS voice list
 * loads. Keyless libraries and public services (edge-tts, google-tts,
 * veoaifree-web) count as working; a failed call still falls through the route.
 *
 * Results are cached per provider for PROBE_TTL_MS so routing and the
 * dashboard do not probe on every request.
 */
const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 1500;
const MEDIA_CONFIG_KEYS = ["ttsConfig", "sttConfig", "searchConfig", "fetchConfig", "videoConfig", "musicConfig", "imageConfig", "embeddingConfig"];

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

// The URL the provider's own request path would call, so the probe checks the
// same server: Local Whisper and self-hosted Firecrawl read the connection
// (and, for Firecrawl, the dashboard setting and FIRECRAWL_BASE_URL) first.
async function serviceUrlFor(providerId, provider) {
  if (providerId === "local-whisper" || providerId === "firecrawl_custom") {
    const [connection] = await getProviderConnections({ provider: providerId, isActive: true }).catch(() => []);
    if (providerId === "local-whisper") return resolveLocalWhisperHost(connection || null);
    const settings = await getSettings().catch(() => ({}));
    return resolveFirecrawlBaseUrl(providerId, { firecrawlBaseUrl: settings?.firecrawlBaseUrl || "" }, connection || null);
  }
  return registryServiceUrl(provider);
}

/** Any HTTP answer means the server is up; refused, DNS failure or timeout means it is not. */
async function answers(url, fetchImpl) {
  try {
    // Same outbound policy as the provider's own requests: a cloud-metadata or
    // otherwise blocked host is "not working", never probed.
    assertOutboundUrlAllowed(url);
    await fetchImpl(new URL(url).origin, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

async function probe(providerId, fetchImpl) {
  if (providerId === "local-device") {
    const voices = await fetchLocalDeviceVoices().catch(() => []);
    return Array.isArray(voices) && voices.length > 0;
  }
  const provider = AI_PROVIDERS[providerId];
  let url;
  try {
    url = await serviceUrlFor(providerId, provider);
  } catch {
    return false; // e.g. an invalid self-hosted Firecrawl URL
  }
  if (!url) return true;
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return isPrivateHost(hostname) ? answers(url, fetchImpl) : true;
}

/**
 * @param {string} providerId
 * @param {{ fetchImpl?: Function, now?: number }} [options]
 * @returns {Promise<boolean>} true for keyed providers (their connection proves setup)
 */
// guardedProbeFetch also validates the resolved address on the socket, so a
// hostname that resolves to a metadata address is refused, not probed.
export function isKeylessProviderWorking(providerId, { fetchImpl = guardedProbeFetch, now = Date.now() } = {}) {
  if (AI_PROVIDERS[providerId]?.noAuth !== true) return Promise.resolve(true);
  const hit = cache.get(providerId);
  if (hit && hit.expiresAt > now) return hit.working;
  const working = probe(providerId, fetchImpl);
  cache.set(providerId, { expiresAt: now + PROBE_TTL_MS, working });
  return working;
}
