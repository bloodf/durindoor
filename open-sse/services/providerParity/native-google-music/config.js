/**
 * Identity and fixed wire constants for the staged Gemini API (AI Studio) Lyria 3 music adapter.
 *
 * Ported from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
 * - open-sse/config/musicRegistry.ts   (`gemini` entry, format `gemini-lyria`)
 * - open-sse/handlers/musicGeneration.ts (`gemini-lyria` dispatch)
 * - open-sse/handlers/mediaGeneration/geminiMusic.ts (wire contract)
 * - src/lib/providerModels/geminiModelsParser.ts (`lyria-*` + generateContent => music)
 *
 * The registry key in the source is `gemini` and it declares no alias. The local
 * `gemini` registry entry also uses `alias: "gemini"`, so no extra alias exists.
 */

export const GEMINI_MUSIC_PROVIDER_ID = "gemini";
export const GEMINI_MUSIC_PROVIDER_ALIASES = Object.freeze([]);
export const GEMINI_MUSIC_FORMAT = "gemini-lyria";
export const GEMINI_MUSIC_ORIGIN = "https://generativelanguage.googleapis.com";
export const GEMINI_MUSIC_BASE_URL = `${GEMINI_MUSIC_ORIGIN}/v1beta/models`;

/** Source registry entry (musicRegistry.ts `gemini`), verbatim, plus the local service kind. */
export const GEMINI_MUSIC_CONFIG = Object.freeze({
  id: GEMINI_MUSIC_PROVIDER_ID,
  aliases: GEMINI_MUSIC_PROVIDER_ALIASES,
  baseUrl: GEMINI_MUSIC_BASE_URL,
  authType: "apikey",
  authHeader: "x-goog-api-key",
  format: GEMINI_MUSIC_FORMAT,
  serviceKind: "music",
  models: Object.freeze([
    Object.freeze({ id: "lyria-3-pro-preview", name: "Lyria 3 Pro (preview)" }),
    Object.freeze({ id: "lyria-3-clip-preview", name: "Lyria 3 Clip (preview)" }),
    Object.freeze({ id: "lyria-3.5", name: "Lyria 3.5" }),
  ]),
  output: Object.freeze({ responseFormat: "b64_json", stream: false, jobs: false }),
});

/** Inline-part mime types the source maps to a container (geminiMusic.ts MIME_TO_FORMAT). */
export const GEMINI_MUSIC_MIME_TO_FORMAT = Object.freeze({
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
});

/** Canonical mime type returned to the caller for each container. */
export const GEMINI_MUSIC_FORMAT_TO_MIME = Object.freeze({
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  webm: "audio/webm",
});

/** Lyria model ids as Google publishes them; anything else is never put in a URL path. */
export const GEMINI_MUSIC_MODEL_ID = /^lyria-[a-z0-9][a-z0-9.-]{0,62}$/;
