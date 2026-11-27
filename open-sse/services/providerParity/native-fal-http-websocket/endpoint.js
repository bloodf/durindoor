// fal endpoint id normalization shared by the HTTP-WebSocket and realtime
// flows. The realtime bundle (../native-fal-realtime) is frozen and accepts
// only full `owner/app[/subpath]` ids; this wrapper adds the source's legacy
// alias table in front of it without editing that bundle.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/falEndpoint.ts (LEGACY_FAL_ENDPOINTS, isLegacyFalEndpoint,
// canonicalFalEndpoint: an explicit alias maps to its full id, every other
// value must already be `owner/app[/subpath]`, at most 300 chars, no `.`/`..`
// segments). The source's realtime path (falRealtimePath) and both socket
// URLs (`wss://fal.run/...` and `wss://ws.fal.run/...`) are built from the
// canonical id, so an alias reaches the same endpoint on either transport.
//
// Fork deviation: the alias lookup uses an own-property check, so inherited
// names such as `constructor` are never treated as aliases.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { canonicalFalRealtimeEndpoint } from "../native-fal-realtime/schema.js";
import { FAL_HTTP_WEBSOCKET_ORIGIN } from "./config.js";

/** The source's legacy short ids and their full fal endpoint ids, verbatim. */
export const FAL_LEGACY_ENDPOINTS = Object.freeze({
  "flux-2-max": "fal-ai/flux-2-max",
  "flux-2-pro": "fal-ai/flux-2-pro",
  "flux-2-flex": "fal-ai/flux-2-flex",
  "flux-pro/v1.1": "fal-ai/flux-pro/v1.1",
  "flux-pro/v1.1-ultra": "fal-ai/flux-pro/v1.1-ultra",
  "flux/dev": "fal-ai/flux/dev",
  "flux/schnell": "fal-ai/flux/schnell",
  "ideogram/v3": "fal-ai/ideogram/v3",
  "bria/text-to-image/3.2": "fal-ai/bria/text-to-image/3.2",
  "bytedance/seedream/v4.5/text-to-image": "fal-ai/bytedance/seedream/v4.5/text-to-image",
  "bytedance/dreamina/v3.1/text-to-image": "fal-ai/bytedance/dreamina/v3.1/text-to-image",
  "recraft/v4/pro/text-to-image": "fal-ai/recraft/v4/pro/text-to-image",
  "recraft/v4/text-to-image": "fal-ai/recraft/v4/text-to-image",
  "stable-diffusion-v35-medium": "fal-ai/stable-diffusion-v35-medium",
  "nano-banana-pro": "fal-ai/nano-banana-pro",
  "nano-banana-2": "fal-ai/nano-banana-2",
  "veo3.1/lite": "fal-ai/veo3.1/lite",
  "ace-step": "fal-ai/ace-step",
});

const LEGACY_TARGETS = new Set(Object.values(FAL_LEGACY_ENDPOINTS));

/** True for a legacy alias or its full target (source isLegacyFalEndpoint). */
export function isLegacyFalEndpoint(value) {
  return isString(value) && (Object.hasOwn(FAL_LEGACY_ENDPOINTS, value) || LEGACY_TARGETS.has(value));
}

/**
 * The full fal endpoint id for `value` (source canonicalFalEndpoint): a legacy
 * alias maps to its target, anything else is checked by the realtime bundle's
 * id check. Throws a 400 FalRealtimeError for a malformed id.
 */
export function canonicalFalEndpoint(value) {
  const endpoint = isString(value) && Object.hasOwn(FAL_LEGACY_ENDPOINTS, value) ? FAL_LEGACY_ENDPOINTS[value] : value;
  return canonicalFalRealtimeEndpoint(endpoint);
}

/**
 * A copy of a fal definition whose `endpoint_id` is canonical. Pass the result
 * to the realtime bundle (connectFalRealtime, falRealtimePath, ...) so an alias
 * reaches the same `wss://fal.run/{endpoint}{path}` the source builds.
 */
export function canonicalFalDefinition(definition) {
  if (!isRecord(definition)) return definition;
  return { ...definition, endpoint_id: canonicalFalEndpoint(definition.endpoint_id) };
}

/** `wss://ws.fal.run/{endpoint}` for an endpoint id or alias (source connectFalHttpWebsocket). */
export function falHttpWebsocketUrl(endpoint) {
  return `${FAL_HTTP_WEBSOCKET_ORIGIN}/${canonicalFalEndpoint(endpoint)}`;
}
