// fal.ai queue video: provider metadata and endpoint ids for the staged,
// unregistered adapter in ./adapter.js. Production code imports none of this
// yet. The shared registry, the catalog and videoProviders/index.js stay as
// they are until the serial registration change (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts, the `fal-ai` entry (baseUrl
// https://queue.fal.run, authType "apikey", authHeader "key", format
// "fal-ai-video", models veo3.1/lite, google/gemini-omni-flash and
// xai/grok-imagine-video/text-to-video), and open-sse/config/falEndpoint.ts
// (LEGACY_FAL_ENDPOINTS, FAL_VENDOR_OWNERS, falModelPath,
// canonicalFalEndpoint, falSelectionEndpoint).
//
// Fork deviations: the existing `fal-ai` image provider keeps its id, its
// `fal` alias and its API-key connection. This bundle adds the video
// service kind to that provider and does not define another one. Only the
// video entries of the source's legacy alias table are kept.
import { isString } from "../../../../src/shared/utils/typeChecks.js";

/** The canonical provider id this adapter serves: the existing image connection. */
export const FAL_VIDEO_PROVIDER_ID = "fal-ai";
/** Aliases of that provider in open-sse/providers/registry/fal-ai.js. */
export const FAL_VIDEO_PROVIDER_ALIASES = Object.freeze(["fal"]);
/** The source registry's format name. */
export const FAL_VIDEO_FORMAT = "fal-ai-video";

/** The source registry's base URL: the fal queue. Every job request goes here. */
export const FAL_QUEUE_ORIGIN = "https://queue.fal.run";
/** fal's platform API, used only to discover an endpoint's OpenAPI input schema. */
export const FAL_API_ORIGIN = "https://api.fal.ai";

/** `Authorization: Key <key>`, the source's `authHeader: "key"`. */
export const falAuthorization = (key) => `Key ${key}`;

/** The three models of the source's `fal-ai` video entry, in source order. */
export const FAL_VIDEO_MODELS = Object.freeze([
  Object.freeze({ id: "veo3.1/lite", name: "Veo 3.1 Lite", family: "veo" }),
  Object.freeze({ id: "google/gemini-omni-flash", name: "Gemini Omni Flash", family: "gemini-omni" }),
  Object.freeze({ id: "xai/grok-imagine-video/text-to-video", name: "Grok Imagine Video", family: "grok-imagine" }),
]);
export const FAL_VIDEO_MODEL_IDS = Object.freeze(FAL_VIDEO_MODELS.map((model) => model.id));

// falEndpoint.ts LEGACY_FAL_ENDPOINTS, video entries only.
const LEGACY_VIDEO_ENDPOINTS = Object.freeze({ "veo3.1/lite": "fal-ai/veo3.1/lite" });

// falEndpoint.ts FAL_VENDOR_OWNERS: ids under these owners are used as given;
// any other id is a first-party app and gets the `fal-ai/` owner.
export const FAL_VENDOR_OWNERS = Object.freeze(new Set([
  "fal-ai", "alibaba", "argil", "blackforestlabs", "bria", "bytedance", "cassetteai", "clarityai",
  "creatify", "decart", "elevenlabs", "google", "lightricks", "luma", "minimax", "mirage-api",
  "mirelo-ai", "moonvalley", "nvidia", "pixelcut", "sonilo", "topaz", "veed", "wan", "xai",
]));

const ENDPOINT_RE = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/;

/** A fal `owner/app[/path]` id, or an Error with `status` 400. */
export function canonicalFalEndpoint(value) {
  const endpoint = LEGACY_VIDEO_ENDPOINTS[value] ?? value;
  if (
    !isString(endpoint) ||
    endpoint.length > 300 ||
    !ENDPOINT_RE.test(endpoint) ||
    endpoint.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw Object.assign(new Error("A fal endpoint must be an owner/app[/subpath] ID"), { status: 400 });
  }
  return endpoint;
}

/** The fal endpoint a selected model id addresses (falSelectionEndpoint). */
export function falVideoEndpoint(model) {
  if (isString(model) && Object.hasOwn(LEGACY_VIDEO_ENDPOINTS, model)) return LEGACY_VIDEO_ENDPOINTS[model];
  const owner = isString(model) ? model.split("/")[0] : "";
  return canonicalFalEndpoint(FAL_VENDOR_OWNERS.has(owner) ? model : `fal-ai/${model}`);
}

/**
 * Which source body builder serves `model`, or null for an endpoint that
 * needs schema discovery (the source's isBuiltInFalVideoModel).
 */
export function falBuiltInFamily(model) {
  if (model === "veo3.1/lite" || model === "fal-ai/veo3.1/lite") return "veo";
  if (!isString(model)) return null;
  if (model === "google/gemini-omni-flash" || model === "google/gemini-omni-flash/image-to-video") return "gemini-omni";
  if (/^xai\/grok-imagine-video\/(text|image|reference)-to-video$/.test(model)) return "grok-imagine";
  return null;
}

/** Catalog metadata the registration change adds to the `fal-ai` provider. */
export const FAL_VIDEO_PROVIDER_METADATA = Object.freeze({
  id: FAL_VIDEO_PROVIDER_ID,
  aliases: FAL_VIDEO_PROVIDER_ALIASES,
  format: FAL_VIDEO_FORMAT,
  serviceKinds: Object.freeze(["video"]),
  videoModels: Object.freeze(FAL_VIDEO_MODELS.map(({ id, name }) => Object.freeze({ id, name }))),
  responseFormats: Object.freeze(["url"]),
  auth: "Authorization: Key <apiKey | accessToken>",
  endpoints: Object.freeze({
    submit: `POST ${FAL_QUEUE_ORIGIN}/{endpoint}`,
    status: `GET ${FAL_QUEUE_ORIGIN}/{endpoint-app}/requests/{request_id}/status`,
    result: `GET ${FAL_QUEUE_ORIGIN}/{endpoint-app}/requests/{request_id}`,
    discover: `GET ${FAL_API_ORIGIN}/v1/models?endpoint_id={endpoint}&expand=openapi-3.0`,
  }),
});
