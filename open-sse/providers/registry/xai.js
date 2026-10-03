export default {
  id: "xai",
  priority: 280,
  alias: "xai",
  display: {
    name: "xAI (Grok)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    notice: {
      apiKeyUrl: "https://console.x.ai",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
    "apikey",
  ],
  hasOAuth: true,
  // Port of OmniRoute#14237: xAI ships new chat ids ahead of a registry seed
  // bump; passthrough keeps unknown model ids from failing validation.
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    validateUrl: "https://api.x.ai/v1/models",
    responsesUrl: "https://api.x.ai/v1/responses",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
  },
  transports: [
    { format: "openai", baseUrl: "https://api.x.ai/v1/chat/completions" },
    { format: "openai-responses", baseUrl: "https://api.x.ai/v1/responses" },
    { format: "openai-responses-oauth", baseUrl: "https://api.x.ai/v1/responses" },
  ],
  models: [
    { id: "grok-4.7", name: "Grok 4.7" },
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "grok-4.5", name: "Grok 4.5", aliases: ["grok-4.5-latest", "grok-build-latest"] },
    { id: "grok-4.3", name: "Grok 4.3", aliases: ["grok-4.3-latest"] },
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning", aliases: ["grok-4.20-reasoning-latest", "grok-4.20", "grok-4.20-reasoning", "grok-4.20-0309", "grok-4.20-beta-0309-reasoning", "grok-4.20-beta", "grok-4.20-beta-0309", "grok-4.20-beta-latest", "grok-4.20-beta-latest-reasoning", "grok-4.20-beta-reasoning", "grok-4.20-experimental-beta-0304-reasoning", "grok-4.20-experimental-beta-0304", "grok-4.20-experimental-beta-reasoning-latest", "grok-4.20-experimental-beta-latest", "grok-4.20-reasoning-gv2"] },
    { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 Non-Reasoning", aliases: ["grok-4.20-non-reasoning", "grok-4.20-non-reasoning-latest", "grok-4.20-beta-non-reasoning", "grok-4.20-beta-latest-non-reasoning", "grok-4.20-experimental-beta-0304-non-reasoning", "grok-4.20-experimental-beta-non-reasoning-latest", "grok-4.20-beta-0309-non-reasoning", "grok-4.20-non-reasoning-gv2"] },
    // Native Responses only. Pinned compatibility aliases exclude canonical current ID.
    { id: "grok-4.20-multi-agent-0309", name: "Grok 4.20 Multi Agent", aliases: ["grok-4.20-multi-agent-latest", "grok-4.20-multi-agent-beta-latest", "grok-4.20-multi-agent-experimental-beta-0304", "grok-4.20-multi-agent-experimental-beta-latest", "grok-4.20-multi-agent-beta-0309"], targetFormat: "openai-responses" },
    { id: "grok-4.20-multi-agent", name: "Grok 4.20 Multi Agent", targetFormat: "openai-responses" },
    { id: "grok-build-0.1", name: "Grok Build 0.1", aliases: ["grok-code-fast-1", "grok-code-fast", "grok-code-fast-1-0825"] },
    { id: "grok-imagine-image-quality", name: "Grok Imagine Image Quality", aliases: ["grok-imagine-image-quality-20260403", "grok-imagine-image-quality-latest", "grok-imagine-image-pro"], params: ["n", "response_format", "aspect_ratio", "resolution"], kind: "image" },
    { id: "grok-imagine-image-2.0", name: "Grok Imagine Image 2.0", params: ["n", "response_format", "aspect_ratio", "resolution", "quality"], kind: "image" },
    { id: "grok-imagine-image", name: "Grok Imagine Image", aliases: ["grok-imagine-image-2026-03-02"], params: ["n", "response_format", "aspect_ratio", "resolution"], kind: "image" },
    { id: "grok-imagine-video-1.5-lite", name: "Grok Imagine Video 1.5 Lite", params: ["duration", "aspect_ratio", "resolution"], kind: "video" },
    { id: "grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", aliases: ["grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-2026-05-30"], params: ["duration", "aspect_ratio", "resolution", "generate_audio"], kind: "video" },
    { id: "grok-imagine-video", name: "Grok Imagine Video", params: ["duration", "aspect_ratio", "resolution"], kind: "video" },
    // Gateway-only route label: xAI TTS has no upstream model field.
    { id: "tts", name: "xAI Text-to-Speech (gateway route)", kind: "tts" },
    // Gateway-only route label. Select an explicit transcription model to pin.
    { id: "stt", name: "xAI Speech-to-Text (gateway route)", kind: "stt" },
    { id: "grok-voice-transcribe-2.0", name: "Grok Voice Transcribe 2.0", kind: "stt" },
    { id: "grok-voice-transcribe-1.0", name: "Grok Voice Transcribe 1.0", kind: "stt" },
    { id: "grok-voice-think-fast-2.0", name: "Grok Voice Think Fast 2.0", aliases: ["grok-voice-latest"], kind: "realtime" },
  ],
  serviceKinds: ["llm","imageToText","webSearch","image","video","tts","stt","realtime"],
  imageConfig: { baseUrl: "https://api.x.ai/v1/images/generations", bodyFields: ["model", "prompt", "n", "response_format", "aspect_ratio", "resolution", "quality"] },
  imageEditConfig: { baseUrl: "https://api.x.ai/v1/images/edits", format: "json" },
  ttsConfig: { baseUrl: "https://api.x.ai/v1/tts", authType: "apikey", authHeader: "bearer", format: "xai-tts" },
  sttConfig: { baseUrl: "https://api.x.ai/v1/stt", authType: "apikey", authHeader: "bearer", format: "xai-stt" },
  realtimeConfig: { wsUrl: "wss://api.x.ai/v1/realtime", authHeader: "Authorization", authScheme: "Bearer", protocols: { realtime: { wsUrl: "wss://api.x.ai/v1/realtime", modelInQuery: true } } },
  // Async video jobs (POST returns { request_id }, GET polls until done/failed).
  // Docs: https://docs.x.ai/developers/rest-api-reference/inference/videos
  videoConfig: { baseUrl: "https://api.x.ai/v1/videos" },
  features: {
    usage: true,
  },
  searchViaChat: {
    defaultModel: "grok-4.7",
    endpoint: "https://api.x.ai/v1/responses",
    pricingUrl: "https://x.ai/api#pricing",
  },
};
