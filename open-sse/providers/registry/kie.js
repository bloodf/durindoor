import { KIE_IMAGE_MODELS, KIE_VIDEO_MODELS, KIE_VIDEO_UNSUPPORTED_MODELS } from "../../services/providerParity/native-kie-video-image/config.js";
import { KIE_AUDIO_FORMAT, KIE_ORIGIN, KIE_STT_MODELS, KIE_TTS_MODELS } from "../../services/providerParity/native-kie-tts-stt/config.js";

export default {
  id: "kie",
  priority: 70,
  alias: "kie",
  display: {
    name: "Kie.ai",
    icon: "bot",
    color: "#F97316",
    textIcon: "KIE",
    website: "https://kie.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.kie.ai/v1/chat/completions",
    validateUrl: "https://api.kie.ai/v1/models",
    authHeader: "bearer",
  },
  models: [
    ...KIE_IMAGE_MODELS.map(({ id, name }) => ({ id, name, kind: "image" })),
    ...KIE_VIDEO_MODELS.filter(({ id }) => !KIE_VIDEO_UNSUPPORTED_MODELS.includes(id)).map(({ id, name }) => ({ id, name, kind: "video" })),
    // ElevenLabs speech and transcription through Kie's createTask job API.
    ...KIE_TTS_MODELS.map(({ id, name }) => ({ id, name, kind: "tts" })),
    ...KIE_STT_MODELS.map(({ id, name }) => ({ id, name, kind: "stt" })),
    { id: "claude-opus-4-8", name: "Claude 4.8 Opus" },
    { id: "claude-opus-4-7", name: "Claude 4.7 Opus" },
    { id: "claude-sonnet-4-6", name: "Claude 4.6 Sonnet" },
    { id: "claude-haiku-4-5", name: "Claude 4.5 Haiku" },
    { id: "gpt-5-5", name: "GPT 5.5" },
    { id: "gpt-5-4", name: "GPT 5.4" },
    { id: "gpt-5-2", name: "GPT 5.2" },
    { id: "gemini-3-1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-2-5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },
    { id: "gemini-3-5-flash", name: "Gemini 3.5 Flash" },
  ],
  serviceKinds: ["llm", "image", "video", "tts", "stt"],
  // Speech runs through TTS_ADAPTERS (no ttsConfig); transcription dispatches on this format.
  sttConfig: { baseUrl: KIE_ORIGIN, authType: "apikey", authHeader: "bearer", format: KIE_AUDIO_FORMAT },
  defaultContextLength: 128000,
};
