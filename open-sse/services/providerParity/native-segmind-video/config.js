// Segmind native video: provider definition, catalog metadata and wire
// constants for the staged, unregistered adapter in ./adapter.js. Production
// code imports none of this yet. The shared registry, the catalog and
// videoProviders/index.js stay as they are until the serial registration
// change (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts, the `segmind` entry (id "segmind", baseUrl
// "https://api.segmind.com/v1", authType "apikey", authHeader "x-api-key",
// format "segmind", models SEGMIND_VIDEO_MODELS), and
// open-sse/config/providers/registry/segmind/videoModels.ts (the five starter
// slugs), and src/shared/constants/providers/apikey/specialty-media.ts (the
// `segmind` API-key connection: name, color, text icon, website, and "more
// models can be routed by using their Segmind slug as the model id").
//
// Fork deviations: this fork had no `segmind` provider at all, so the
// definition below is new. It carries the video service kind only; Segmind
// images are a separate source entry (imageRegistryData.ts) outside this
// delta. `wan2.7-i2v` is listed by the source but cannot work through the
// source body (it never sends an image), so it is kept in the source list and
// refused before submit here.
import { isString } from "../../../../src/shared/utils/typeChecks.js";

export const SEGMIND_PROVIDER_ID = "segmind";
/** The source connection's alias is the id itself, so there is no other alias. */
export const SEGMIND_PROVIDER_ALIASES = Object.freeze([]);
/** The source registry's format name. */
export const SEGMIND_VIDEO_FORMAT = "segmind";

/** The only origin the key is sent to. Connection base URLs are ignored. */
export const SEGMIND_ORIGIN = "https://api.segmind.com";
export const SEGMIND_BASE_URL = `${SEGMIND_ORIGIN}/v1`;
/** The source's auth header: the key itself, no scheme. */
export const SEGMIND_AUTH_HEADER = "x-api-key";

// A Segmind model slug is one path segment: POST /v1/{slug}.
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const IMAGE_INPUT_SLUG_RE = /(?:^|[-_.])i2v(?:$|[-_.])|image-to-video|img2vid/i;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** The source's SEGMIND_VIDEO_MODELS, in source order. */
export const SEGMIND_SOURCE_VIDEO_MODELS = freezeAll([
  { id: "wan2.1-t2v", name: "Wan 2.1 Text-to-Video" },
  { id: "wan2.7-i2v", name: "Wan 2.7 Image-to-Video" },
  { id: "hunyuan-video-t2v", name: "Hunyuan Video Text-to-Video" },
  { id: "ltx-video-t2v", name: "LTX Video Text-to-Video" },
  { id: "kling-video-t2v", name: "Kling Video Text-to-Video" },
]);

/** Source models this adapter can serve: the text-to-video ones. */
export const SEGMIND_VIDEO_MODELS = freezeAll(
  SEGMIND_SOURCE_VIDEO_MODELS.filter((model) => !segmindNeedsImage(model.id)).map((model) => ({ ...model, kind: "video" }))
);
export const SEGMIND_VIDEO_MODEL_IDS = Object.freeze(SEGMIND_VIDEO_MODELS.map((model) => model.id));

/** Whether a slug names an image-to-video model, which needs an input image the source never sends. */
export function segmindNeedsImage(slug) {
  return isString(slug) && IMAGE_INPUT_SLUG_RE.test(slug);
}

/**
 * The Segmind slug a selected model id addresses (a starter slug or, as the
 * source documents, any other Segmind slug), or an Error with `status` 400.
 */
export function segmindVideoSlug(model) {
  const slug = isString(model) && model.startsWith(`${SEGMIND_PROVIDER_ID}/`) ? model.slice(SEGMIND_PROVIDER_ID.length + 1) : model;
  if (!isString(slug) || !SLUG_RE.test(slug) || /^\.+$/.test(slug) || slug.includes("..")) {
    throw Object.assign(new Error("A Segmind model must be a single Segmind model slug"), { status: 400 });
  }
  if (segmindNeedsImage(slug)) {
    throw Object.assign(new Error(`Segmind model '${slug}' needs an input image, which this adapter does not send`), { status: 400 });
  }
  return slug;
}

/** The fixed submit URL for a validated slug. */
export const segmindVideoUrl = (slug) => `${SEGMIND_BASE_URL}/${slug}`;

// Gateway bounds. Segmind answers the POST only when the video is ready, so
// one deadline covers the request, the wait and the body read.
export const SEGMIND_VIDEO_TIMEOUT_MS = 600_000;
/** Largest video body read into memory. */
export const SEGMIND_VIDEO_MAX_BYTES = 64 * 1024 * 1024;
export const SEGMIND_VIDEO_RESPONSE_FORMATS = Object.freeze(["b64_json"]);

/**
 * The provider definition the registration change adds as
 * open-sse/providers/registry/segmind.js (local registry shape).
 */
export const SEGMIND_PROVIDER_DEFINITION = Object.freeze({
  id: SEGMIND_PROVIDER_ID,
  priority: 70,
  alias: SEGMIND_PROVIDER_ID,
  display: Object.freeze({
    name: "Segmind",
    icon: "video",
    color: "#7C3AED",
    textIcon: "SG",
    website: "https://segmind.com",
  }),
  category: "apikey",
  authType: "apikey",
  transport: Object.freeze({
    baseUrl: SEGMIND_BASE_URL,
    authHeader: SEGMIND_AUTH_HEADER,
    auth: Object.freeze({ combined: true, header: SEGMIND_AUTH_HEADER, scheme: "raw" }),
  }),
  models: SEGMIND_VIDEO_MODELS,
  serviceKinds: Object.freeze(["video"]),
});

/** Catalog metadata for docs/providers/catalog.mdx and the dashboard. */
export const SEGMIND_VIDEO_PROVIDER_METADATA = Object.freeze({
  id: SEGMIND_PROVIDER_ID,
  aliases: SEGMIND_PROVIDER_ALIASES,
  format: SEGMIND_VIDEO_FORMAT,
  authType: "apikey",
  auth: "x-api-key: <apiKey | accessToken>",
  serviceKinds: Object.freeze(["video"]),
  videoModels: Object.freeze(SEGMIND_VIDEO_MODELS.map(({ id, name }) => Object.freeze({ id, name }))),
  refusedSourceModels: Object.freeze(["wan2.7-i2v"]),
  customModels: "any other single Segmind slug (no discovery API is used; text-to-video only)",
  responseFormats: SEGMIND_VIDEO_RESPONSE_FORMATS,
  endpoints: Object.freeze({ generate: `POST ${SEGMIND_BASE_URL}/{model}` }),
});
