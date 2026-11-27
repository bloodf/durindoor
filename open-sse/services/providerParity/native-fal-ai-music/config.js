// fal.ai ACE-Step music: provider metadata for the staged, unregistered
// adapter in ./adapter.js. Nothing here is imported by production code yet;
// the shared registry, catalog and musicGenerationCore.js stay untouched until
// the serial registration change (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/musicRegistry.ts, the `fal-ai` entry (id "fal-ai", baseUrl
// "https://queue.fal.run", authType "apikey", authHeader "key", format
// "fal-ai-music", one model `ace-step` "ACE-Step"), and
// open-sse/config/falEndpoint.ts (the legacy alias `ace-step` ->
// `fal-ai/ace-step`).

/** The canonical provider id: the existing `fal-ai` API-key connection. */
export const FAL_MUSIC_PROVIDER_ID = "fal-ai";
/** Aliases of that provider in open-sse/providers/registry/fal-ai.js. */
export const FAL_MUSIC_PROVIDER_ALIASES = Object.freeze(["fal"]);
/** The source registry's format name. */
export const FAL_MUSIC_FORMAT = "fal-ai-music";

/** Queue origin of the source registry entry. Every queue request goes here. */
export const FAL_QUEUE_ORIGIN = "https://queue.fal.run";
/** Origin of fal's model catalog (source FalClient.discover). */
export const FAL_CATALOG_ORIGIN = "https://api.fal.ai";

/** The source entry's one model. `fal-ai/ace-step` is the same endpoint, spelled out. */
export const FAL_MUSIC_MODELS = Object.freeze([
  Object.freeze({ id: "ace-step", name: "ACE-Step", endpoint: "fal-ai/ace-step", aliases: Object.freeze(["fal-ai/ace-step"]) }),
]);
export const FAL_MUSIC_MODEL_IDS = Object.freeze(FAL_MUSIC_MODELS.map((model) => model.id));

/** The response formats this adapter can return: fal answers with a hosted file URL. */
export const FAL_MUSIC_RESPONSE_FORMATS = Object.freeze(["url"]);

/** Catalog metadata the registration change adds to the `fal-ai` provider. */
export const FAL_MUSIC_PROVIDER_METADATA = Object.freeze({
  id: FAL_MUSIC_PROVIDER_ID,
  aliases: FAL_MUSIC_PROVIDER_ALIASES,
  format: FAL_MUSIC_FORMAT,
  authType: "apikey",
  authHeader: "Authorization: Key <apiKey>",
  serviceKinds: Object.freeze(["music"]),
  musicModels: Object.freeze(FAL_MUSIC_MODELS.map(({ id, name }) => Object.freeze({ id, name }))),
  musicConfig: Object.freeze({ baseUrl: FAL_QUEUE_ORIGIN }),
  responseFormats: FAL_MUSIC_RESPONSE_FORMATS,
  endpoints: Object.freeze({
    submit: "POST https://queue.fal.run/fal-ai/ace-step",
    status: "GET https://queue.fal.run/fal-ai/ace-step/requests/{request_id}/status",
    result: "GET https://queue.fal.run/fal-ai/ace-step/requests/{request_id}",
    discovery: "GET https://api.fal.ai/v1/models?endpoint_id=fal-ai%2Face-step&expand=openapi-3.0",
  }),
});

/** The model entry for a public model id or its alias, or null. */
export function falMusicModel(id) {
  return FAL_MUSIC_MODELS.find((model) => model.id === id || model.aliases.includes(id)) ?? null;
}
