// Gemini TTS — generateContent with AUDIO modality returns PCM L16, wrap as WAV
import { Buffer } from "node:buffer";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "../../providers/index.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const TTS_CFG = PROVIDER_MEDIA["gemini"]?.ttsConfig || {};
const TTS_BASE = TTS_CFG.baseUrl;
const FALLBACK_MODEL = TTS_CFG.defaultModel || "gemini-3.8-flash-tts";
const KNOWN_MODELS = [
  ...(TTS_CFG.models || []),
  ...(PROVIDER_MODELS["gemini-tts-models"] || []),
  ...(PROVIDER_MODELS.gemini || []).filter((m) => (m.kind || m.type) === "tts"),
]
  .map((m) => m?.id)
  .filter(Boolean)
  .filter((id, index, list) => list.indexOf(id) === index);
const DEFAULT_MODEL = KNOWN_MODELS[0] || FALLBACK_MODEL;
const DEFAULT_VOICE = "Kore";

// Parse "model/voice" — if input doesn't match a known TTS model, treat it as voice with default model
function parseGeminiModelVoice(input) {
  if (!input) return { modelId: DEFAULT_MODEL, voiceId: DEFAULT_VOICE };
  for (const id of KNOWN_MODELS) {
    if (input === id) return { modelId: id, voiceId: DEFAULT_VOICE };
    if (input.startsWith(`${id}/`)) return { modelId: id, voiceId: input.slice(id.length + 1) };
  }
  return { modelId: DEFAULT_MODEL, voiceId: input };
}
// Gemini returns PCM 16-bit signed mono @ 24kHz
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

// Build WAV header for raw PCM payload
function pcmToWav(pcmBuffer) {
  const dataSize = pcmBuffer.length;
  const byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8;
  const blockAlign = CHANNELS * BITS_PER_SAMPLE / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// Build TTS prompt: add "Say [in {language}]:" prefix to force TTS mode
function buildPrompt(text, language) {
  if (/:\s/.test(text)) return text; // user already provided style instruction
  return language ? `Say in ${language}: ${text}` : `Say: ${text}`;
}

export default {
  async synthesize(text, model, credentials, _responseFormat, opts = {}) {
    if (!credentials?.apiKey) throw new Error("No Gemini API key configured");
    const { modelId, voiceId } = parseGeminiModelVoice(model);
    const isGemini38 = modelId.startsWith("gemini-3.8-");
    const url = isGemini38 ? "https://generativelanguage.googleapis.com/v1beta/interactions" : `${TTS_BASE}/${modelId}:generateContent?key=${credentials.apiKey}`;
    const body = isGemini38 ? {
      model: modelId,
      input: [{ type: "user_input", content: [{ type: "text", text, ...(opts.style ? { annotations: [{ type: "speech_metadata", style: opts.style }] } : null) }] }],
      response_format: { type: "audio", mime_type: "audio/wav" },
      generation_config: { speech_config: [{ voice: voiceId }] },
    } : {
      contents: [{ parts: [{ text: buildPrompt(text, opts.language) }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } } },
    };
    const res = await proxyAwareFetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(isGemini38 ? { "x-goog-api-key": credentials.apiKey } : null) }, body: JSON.stringify(body), signal: opts.signal }, opts.proxyOptions);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini TTS failed: ${res.status}`);
    }
    const data = await res.json();
    const audio = isGemini38 ? data?.steps?.filter((step) => step.type === "model_output").flatMap((step) => step.content || []).filter((content) => content.type === "audio").at(-1) : data?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!audio?.data) {
      const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "unknown";
      throw new Error(`Gemini TTS returned no audio (finishReason: ${reason}, voice: ${voiceId}, model: ${modelId})`);
    }
    const bytes = Buffer.from(audio.data, "base64");
    const mime = audio.mime_type || audio.mimeType;
    const isWav = mime === "audio/wav" || bytes.subarray(0, 4).toString("ascii") === "RIFF";
    if (mime && mime !== "audio/wav" && mime !== "audio/l16" && mime !== "audio/pcm") throw new Error(`Unsupported Gemini audio MIME type: ${mime}`);
    const wav = isWav ? bytes : pcmToWav(bytes);
    return { base64: wav.toString("base64"), format: "wav" };
  },
};

// Voice fetcher — return prebuilt voices (Gemini has no list API)
const PREBUILT_VOICES = [
  { id: "Zephyr", lang: "en", gender: "Female" },
  { id: "Puck", lang: "en", gender: "Male" },
  { id: "Charon", lang: "en", gender: "Male" },
  { id: "Kore", lang: "en", gender: "Female" },
  { id: "Fenrir", lang: "en", gender: "Male" },
  { id: "Leda", lang: "en", gender: "Female" },
  { id: "Orus", lang: "en", gender: "Male" },
  { id: "Aoede", lang: "en", gender: "Female" },
  { id: "Callirrhoe", lang: "en", gender: "Female" },
  { id: "Autonoe", lang: "en", gender: "Female" },
  { id: "Enceladus", lang: "en", gender: "Male" },
  { id: "Iapetus", lang: "en", gender: "Male" },
  { id: "Umbriel", lang: "en", gender: "Male" },
  { id: "Algieba", lang: "en", gender: "Male" },
  { id: "Despina", lang: "en", gender: "Female" },
  { id: "Erinome", lang: "en", gender: "Female" },
  { id: "Algenib", lang: "en", gender: "Male" },
  { id: "Rasalgethi", lang: "en", gender: "Male" },
  { id: "Laomedeia", lang: "en", gender: "Female" },
  { id: "Achernar", lang: "en", gender: "Female" },
  { id: "Alnilam", lang: "en", gender: "Male" },
  { id: "Schedar", lang: "en", gender: "Male" },
  { id: "Gacrux", lang: "en", gender: "Female" },
  { id: "Pulcherrima", lang: "en", gender: "Female" },
  { id: "Achird", lang: "en", gender: "Male" },
  { id: "Zubenelgenubi", lang: "en", gender: "Male" },
  { id: "Vindemiatrix", lang: "en", gender: "Female" },
  { id: "Sadachbia", lang: "en", gender: "Male" },
  { id: "Sadaltager", lang: "en", gender: "Male" },
  { id: "Sulafat", lang: "en", gender: "Female" },
];

export async function fetchGeminiVoices() {
  return PREBUILT_VOICES.map((v) => ({ voice_id: v.id, name: v.id, labels: { language: v.lang, gender: v.gender } }));
}
