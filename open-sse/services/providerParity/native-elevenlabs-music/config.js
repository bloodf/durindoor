/**
 * Identity and fixed wire constants for the staged ElevenLabs Eleven Music adapter.
 *
 * Ported from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad:
 * - open-sse/config/musicRegistry.ts                      (`elevenlabs`, format `elevenlabs-music`)
 * - open-sse/handlers/musicGeneration.ts                  (`elevenlabs-music` dispatch)
 * - open-sse/handlers/mediaGeneration/elevenLabsMusic.ts  (wire contract)
 * - open-sse/handlers/mediaGeneration/elevenLabsSchemas.ts (elevenLabsMusicSchema limits)
 *
 * The source music registry key is `elevenlabs` with no alias. The local
 * `elevenlabs` provider registry declares `alias: "el"`, which already resolves
 * to the same connection, so it is accepted as the only alias.
 */

export const ELEVENLABS_MUSIC_PROVIDER_ID = "elevenlabs";
export const ELEVENLABS_MUSIC_PROVIDER_ALIASES = Object.freeze(["el"]);
export const ELEVENLABS_MUSIC_FORMAT = "elevenlabs-music";
export const ELEVENLABS_MUSIC_ORIGIN = "https://api.elevenlabs.io";
export const ELEVENLABS_MUSIC_BASE_URL = `${ELEVENLABS_MUSIC_ORIGIN}/v1/music`;
export const ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/** Source registry entry (musicRegistry.ts `elevenlabs`), verbatim, plus the local service kind. */
export const ELEVENLABS_MUSIC_CONFIG = Object.freeze({
  id: ELEVENLABS_MUSIC_PROVIDER_ID,
  aliases: ELEVENLABS_MUSIC_PROVIDER_ALIASES,
  baseUrl: ELEVENLABS_MUSIC_BASE_URL,
  authType: "apikey",
  authHeader: "xi-api-key",
  format: ELEVENLABS_MUSIC_FORMAT,
  serviceKind: "music",
  models: Object.freeze([
    Object.freeze({ id: "music_v1", name: "Eleven Music V1" }),
    Object.freeze({ id: "music_v2", name: "Eleven Music V2" }),
    Object.freeze({ id: "music_v2_5", name: "Eleven Music V2.5" }),
  ]),
  output: Object.freeze({ responseFormat: "b64_json", stream: false, jobs: false }),
});

/** Response content types the source maps to a container (elevenLabsMusic.ts `formats`). */
export const ELEVENLABS_MUSIC_MIME_TO_FORMAT = Object.freeze({
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/pcm": "pcm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
});

/** Source elevenLabsMusicSchema numeric limits. */
export const ELEVENLABS_MUSIC_LIMITS = Object.freeze({
  promptMaxChars: 4100,
  musicLengthMinMs: 3000,
  musicLengthMaxMs: 600000,
  seedMax: 2147483647,
});

/**
 * `output_format` values are `<codec>_<sample rate>[_<bitrate>]`. The source
 * forwards any string; only these codecs are accepted here, so the reported
 * container is never a guess from an arbitrary prefix.
 */
export const ELEVENLABS_MUSIC_OUTPUT_FORMAT = /^(mp3|pcm|ulaw|alaw|opus|wav)_\d{4,5}(?:_\d{2,3})?$/;
