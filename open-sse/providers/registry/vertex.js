// Native media on the existing Vertex connection, ported from
// cheaper-inference/OmniRoute (MIT) c71f0065a7efe9230ec23b96a12253b050c4d7ad:
// open-sse/config/videoRegistry.ts, audioRegistry.ts and musicRegistry.ts
// (`vertex` entries) with open-sse/executors/vertexMedia.ts. The native adapters
// own their endpoints, auth modes and limits; these rows are the catalog only.
//
// Video lists only the Veo 3.1 models. Google retired veo-3.0-generate-001,
// veo-3.0-fast-generate-001 and veo-2.0-generate-001 on 2026-06-30
// (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions,
// checked 2026-11-27), so they are not advertised.
const VIDEO_MODELS = [
  { id: "veo-3.1-generate-001", name: "Veo 3.1 (Vertex)", kind: "video", params: ["duration", "aspect_ratio", "negative_prompt"] },
  { id: "veo-3.1-fast-generate-001", name: "Veo 3.1 Fast (Vertex)", kind: "video", params: ["duration", "aspect_ratio", "negative_prompt"] },
];
const MUSIC_MODELS = [
  { id: "lyria-002", name: "Lyria 2 (Vertex)", kind: "music", params: ["negative_prompt", "seed", "sample_count"] },
];
// The adapters choose the regional, multi-region or Express endpoint per
// connection; this base URL is the source's default region, kept as metadata.
const SOURCE_BASE_URL = "https://us-central1-aiplatform.googleapis.com/v1";

export default {
  id: "vertex",
  priority: 40,
  alias: "vertex",
  aliases: [
    "vx",
  ],
  uiAlias: "vx",
  display: {
    name: "Vertex AI",
    icon: "cloud",
    color: "#4285F4",
    textIcon: "VX",
    website: "https://cloud.google.com/vertex-ai",
    notice: {
      text: "New Google Cloud accounts get $300 free credits. A credit card or other payment method is required (checked 2026-11-23). Requires GCP project + Service Account with Vertex AI API enabled.",
      apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://aiplatform.googleapis.com",
    format: "vertex",
  },
  models: [
    // Argon is served from global/us/eu,
    // not us-central1 (Google Gemini 4 Argon model page, checked 2026-11-02;
    // upstream 9router 29fc880e). defaultLocation keeps connections without a
    // configured location off us-central1.
    { id: "gemini-4-argon", name: "Gemini 4 Argon", defaultLocation: "global" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ...VIDEO_MODELS,
    ...MUSIC_MODELS,
  ],
  serviceKinds: ["llm", "imageToText", "video", "tts", "stt", "music"],
  // Gemini speech through generateContent; WAV, PCM or JSON only.
  ttsConfig: {
    baseUrl: SOURCE_BASE_URL,
    authType: "apikey",
    authHeader: "bearer",
    format: "vertex-gemini-tts",
    defaultModel: "gemini-3.1-flash-tts-preview",
    defaultVoice: "Kore",
    models: [
      { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS (Vertex)" },
      { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS (Vertex)" },
      { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS (Vertex)" },
      { id: "gemini-3.8-flash-tts", name: "Gemini 3.8 Flash TTS (Vertex)" },
      { id: "gemini-3.8-flash-lite-tts", name: "Gemini 3.8 Flash-Lite TTS (Vertex)" },
    ],
  },
  // Gemini transcription through generateContent; no translations endpoint.
  sttConfig: {
    baseUrl: SOURCE_BASE_URL,
    authType: "apikey",
    authHeader: "bearer",
    format: "vertex-gemini",
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Vertex Transcribe)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Vertex Transcribe)" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (Vertex Transcribe)" },
    ],
  },
  // Lyria 2, synchronous WAV as b64_json. No videoConfig: /v1/videos has no
  // accepted-job ledger, so Veo runs only on /v1/video/generations.
  musicConfig: { baseUrl: SOURCE_BASE_URL, authType: "apikey", authHeader: "bearer", format: "vertex-lyria" },
};
