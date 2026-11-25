// ElevenLabs TTS — voice id with optional model_id prefix
import { Buffer } from "node:buffer";

const VOICES_TTL = 24 * 60 * 60 * 1000;
const _voicesCache = new Map(); // by API key
const _modelsCache = new Map(); // by API key

export async function fetchElevenLabsVoices(apiKey) {
  if (!apiKey) throw new Error("ElevenLabs API key required");
  const now = Date.now();
  const cached = _voicesCache.get(apiKey);
  if (cached && now - cached.time < VOICES_TTL) return cached.voices;

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`ElevenLabs voices fetch failed: ${res.status}`);
  const data = await res.json();
  // Normalize: derive lang from labels for grouping
  const voices = (data.voices || []).map((v) => ({ ...v, lang: v.labels?.language || "en" }));
  _voicesCache.set(apiKey, { voices, time: now });
  return voices;
}

export async function fetchElevenLabsModels(apiKey) {
  if (!apiKey) throw new Error("ElevenLabs API key required");
  const now = Date.now();
  const cached = _modelsCache.get(apiKey);
  if (cached && now - cached.time < VOICES_TTL) return cached.models;
  const res = await fetch("https://api.elevenlabs.io/v1/models", { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs models fetch failed: ${res.status}`);
  const data = await res.json();
  const models = (Array.isArray(data) ? data : []).filter((m) => m.can_do_text_to_speech && !m.requires_alpha_access)
    .map((m) => ({ id: m.model_id, name: m.name || m.model_id, type: "tts" }));
  _modelsCache.set(apiKey, { models, time: now });
  return models;
}

// Map supported OpenAI speech response formats to ElevenLabs output codecs.
const OUTPUT_FORMATS = {
  mp3: { param: "mp3_44100_128", format: "mp3" },
  opus: { param: "opus_48000_128", format: "opus" },
  wav: { param: "wav_24000", format: "wav" },
  pcm: { param: "pcm_24000", format: "pcm" },
};
const PASSTHROUGH_FIELDS = [
  "voice_settings", "seed", "apply_text_normalization", "previous_text", "next_text",
  "pronunciation_dictionary_locators",
];

export default {
  async synthesize(text, model, credentials, responseFormat, options = {}) {
    if (!credentials?.apiKey) throw new Error("ElevenLabs API key required");
    let modelId = "eleven_flash_v2_5";
    let voiceId = model;
    if (model && model.includes("/")) [modelId, voiceId] = model.split("/");
    else if (model?.startsWith("eleven_")) {
      modelId = model;
      voiceId = options.voice;
    }
    else if (options.voice) voiceId = options.voice;
    if (!voiceId) throw new Error("ElevenLabs voice is required");

    const output = OUTPUT_FORMATS[responseFormat] || OUTPUT_FORMATS.mp3;
    const body = { text, model_id: modelId };
    if (options.language) body.language_code = options.language;
    for (const key of PASSTHROUGH_FIELDS) {
      if (options[key] !== undefined) body[key] = options[key];
    }
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${output.param}`, {
      method: "POST",
      headers: { "xi-api-key": credentials.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(err?.detail?.message || `ElevenLabs TTS failed: ${res.status}`);
      if (res.status >= 400 && res.status < 500) error.status = res.status;
      throw error;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) throw new Error("ElevenLabs TTS returned empty audio");
    return { base64: Buffer.from(buf).toString("base64"), format: output.format };
  },
};
