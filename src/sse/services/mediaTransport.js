import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { getVideoConfig } from "open-sse/handlers/videoCore.js";
import { supportsVideoGeneration } from "open-sse/handlers/videoGenerationCore.js";
import { supportsSttTranslation } from "open-sse/handlers/sttCore.js";
import { getImageAdapter } from "open-sse/handlers/imageProviders/index.js";
import { getEmbeddingAdapter } from "open-sse/handlers/embeddingProviders/index.js";
import { getTtsAdapter } from "open-sse/handlers/ttsProviders/index.js";
import { FORMAT_HANDLERS } from "open-sse/handlers/ttsProviders/genericFormats.js";
import { MEDIA_KIND_TRANSPORTS, MEDIA_ROUTE_KINDS } from "@/shared/constants/mediaRoutes.js";

/**
 * Transport support for the media kinds.
 *
 * The registry already describes which provider serves which kind: its
 * `serviceKinds` names the kinds, and each kind has a config block
 * (`ttsConfig`, `sttConfig`, `videoConfig`, …) or a dedicated adapter. This
 * module turns that metadata into the two questions the gateway asks:
 *
 * - can this provider serve this kind at all (its transport), and
 * - can this provider serve this endpoint (the endpoint's own rule).
 *
 * It lives apart from mediaRoutes.js so the endpoint handlers can ask without
 * pulling the route service (settings, catalogs, keyless probes) along.
 */

/**
 * The transport that serves each kind: the dispatcher the gateway actually
 * calls for that provider. A provider without one cannot run the kind, no
 * matter what the catalog or a live catalog says about it.
 */
const KIND_TRANSPORT = Object.freeze({
  image: (providerId) => !!getImageAdapter(providerId),
  embedding: (providerId) => !!getEmbeddingAdapter(providerId),
  tts: (providerId) => !!getTtsAdapter(providerId) || !!FORMAT_HANDLERS[AI_PROVIDERS[providerId]?.ttsConfig?.format],
  stt: (providerId) => !!AI_PROVIDERS[providerId]?.sttConfig,
  video: (providerId) => !!getVideoConfig(providerId) || supportsVideoGeneration(providerId),
  music: (providerId) => !!AI_PROVIDERS[providerId]?.musicConfig,
  webSearch: (providerId) => !!AI_PROVIDERS[providerId]?.searchConfig || !!AI_PROVIDERS[providerId]?.searchViaChat,
  webFetch: (providerId) => !!AI_PROVIDERS[providerId]?.fetchConfig
});

/**
 * Kinds whose dispatcher is a dedicated adapter. Without the adapter a
 * request can only fail, so a provider without one is excluded even when the
 * registry does not describe it (custom nodes, live catalog rows).
 */
const ADAPTER_KINDS = Object.freeze(new Set(["image", "embedding"]));

/** The human label of a media kind, as the route errors use it. */
export function mediaKindLabel(kind) {
  return MEDIA_ROUTE_KINDS.find((k) => k.id === kind)?.label.toLowerCase() || kind;
}

/**
 * Whether a provider can serve a media kind.
 *
 * - "supported": the provider carries the transport that serves the kind.
 * - "unsupported": the provider is known and cannot serve the kind.
 * - "unknown": the registry does not describe this provider for the kind
 *   (a custom node or a live catalog row), so the request stays dispatchable
 *   and the endpoint decides.
 */
export function mediaTransportSupport(kind, providerId) {
  const check = KIND_TRANSPORT[kind];
  if (!check) return "unknown";
  if (check(providerId)) return "supported";
  if (ADAPTER_KINDS.has(kind)) return "unsupported";
  const provider = AI_PROVIDERS[providerId];
  if (!provider) return "unknown";
  const kinds = Array.isArray(provider.serviceKinds) ? provider.serviceKinds : [];
  return kinds.includes(kind) ? "unsupported" : "unknown";
}

/** /v1/videos runs async job APIs; veoaifree-web's videoConfig is the sync generator. */
export const supportsVideoJobs = (providerId) => !!getVideoConfig(providerId) && !supportsVideoGeneration(providerId);
export const supportsTranslation = (providerId, model) => supportsSttTranslation(AI_PROVIDERS[providerId]?.sttConfig, model);

/**
 * Endpoints that run only part of their kind's models. A `null` entry means
 * the endpoint runs every model of the kind. The keys are the endpoints of
 * MEDIA_KIND_TRANSPORTS, so a kind without an entry runs everywhere.
 */
export const MEDIA_ENDPOINT_SUPPORTS = Object.freeze({
  video: Object.freeze({
    "/v1/video/generations": supportsVideoGeneration,
    "/v1/videos": supportsVideoJobs
  }),
  stt: Object.freeze({
    "/v1/audio/transcriptions": null,
    "/v1/audio/translations": supportsTranslation
  })
});

/** Endpoints that can run only part of their kind's models, shown per endpoint on the dashboard. */
export const MEDIA_ROUTE_ENDPOINTS = Object.freeze(
  Object.fromEntries(
    Object.entries(MEDIA_KIND_TRANSPORTS).map(([kind, meta]) => [
      kind,
      Object.freeze(meta.endpoints.map((path) => Object.freeze({
        path,
        supports: MEDIA_ENDPOINT_SUPPORTS[kind]?.[path] ?? null
      })))
    ])
  )
);

/** Why a provider cannot run an endpoint, in words that stay true for the provider. */
function endpointReason(kind, endpoint, providerId) {
  if (kind === "video" && endpoint === "/v1/video/generations") {
    const hint = getVideoConfig(providerId) ? " Use /v1/videos for asynchronous video jobs." : "";
    return `Provider '${providerId}' does not support synchronous video generation on /v1/video/generations.${hint}`;
  }
  if (kind === "video" && endpoint === "/v1/videos") {
    const hint = supportsVideoGeneration(providerId) ? " Use /v1/video/generations for synchronous video generation." : "";
    return `Provider '${providerId}' does not support asynchronous video jobs on /v1/videos.${hint}`;
  }
  return `Provider '${providerId}' does not support ${mediaKindLabel(kind)} on ${endpoint}.`;
}

/**
 * Whether a provider can run one media endpoint, and why not when it cannot.
 *
 * The kind's transport comes first: a provider without it cannot serve the
 * kind at all. Then the endpoint's own rule: a provider that serves the kind
 * on a different endpoint is not reported as unsupported here.
 *
 * @param {string} kind - one of MEDIA_ROUTE_KINDS
 * @param {string} endpoint - the endpoint path the request targets
 * @param {string} providerId - resolved provider id
 * @param {string|null} [model] - provider-local model id, for endpoint rules that depend on it
 * @returns {{ supported: boolean, reason: string|null }}
 */
export function mediaEndpointSupport(kind, endpoint, providerId, model = null) {
  if (mediaTransportSupport(kind, providerId) === "unsupported") {
    return { supported: false, reason: `Provider '${providerId}' does not support ${mediaKindLabel(kind)}.` };
  }
  const supports = MEDIA_ENDPOINT_SUPPORTS[kind]?.[endpoint];
  if (supports && !supports(providerId, model)) {
    return { supported: false, reason: endpointReason(kind, endpoint, providerId) };
  }
  return { supported: true, reason: null };
}
