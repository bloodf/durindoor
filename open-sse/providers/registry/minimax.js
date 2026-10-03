import { CLAUDE_API_HEADERS } from "../shared.js";
import { INLINE_THINKING_FORMATS } from "../schema.js";

const M3_OPENAI_INLINE_THINKING = Object.freeze({
  format: INLINE_THINKING_FORMATS.THINK_TAGS,
  models: Object.freeze(["MiniMax-M3"]),
});

export default {
  id: "minimax",
  priority: 90,
  alias: "minimax",
  display: {
    name: "MiniMax",
    icon: "memory",
    color: "#7C3AED",
    textIcon: "MM",
    website: "https://www.minimax.io",
    notice: {
      text: "MiniMax-M3.1-Flash-Preview requires M Plan or MiniMax Code. MiniMax-H3 and MiniMax-H3-Max require pay-as-you-go API. Subscription and pay-as-you-go keys are separate.",
      apiKeyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.minimax.io/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    quirks: {
      dropOutputConfig: true,
      preserveOutputConfigModels: ["MiniMax-M3.1-Flash-Preview"],
      requireClaudeToolType: true,
      ensureThinkingSignature: true,
    },
    reasoningInject: {
      scope: "all",
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    usage: {
      urls: [
        "https://www.minimax.io/v1/token_plan/remains",
        "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
      ],
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.minimax.io/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
      quirks: { inlineThinking: M3_OPENAI_INLINE_THINKING },
      // MiniMax OpenAI API: split thinking into reasoning_details (vendor-recommended for OpenAI clients).
      // Ported from upstream decolua/9router PR #2525 (head 72385571c6).
      requestDefaults: { reasoning_split: true },
      // Upstream still reasons; don't forward thinking fields to OpenAI clients (OpenCode shows them).
      omitStreamReasoning: true,
    },
    {
      format: "claude",
      baseUrl: "https://api.minimax.io/anthropic/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.minimax.io/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" }
    },
  ],
  models: [
    { id: "MiniMax-M3.1-Flash-Preview", name: "MiniMax M3.1 Flash Preview" },
    { id: "MiniMax-M3", name: "MiniMax M3" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.5-highspeed", name: "MiniMax M2.5 Highspeed" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
    { id: "MiniMax-M2.1-highspeed", name: "MiniMax M2.1 Highspeed" },
    { id: "MiniMax-M2", name: "MiniMax M2" },
    { id: "M2-her", name: "MiniMax M2 Her", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "image-01", name: "MiniMax Image-01", params: ["n","size","response_format"], kind: "image" },
    { id: "MiniMax-H3", name: "MiniMax H3", params: ["duration","resolution","aspect_ratio"], kind: "video" },
    { id: "MiniMax-H3-Max", name: "MiniMax H3 Max", params: ["duration","resolution","aspect_ratio"], kind: "video" },
    { id: "MiniMax-Hailuo-2.3", name: "MiniMax Hailuo 2.3", params: ["duration","resolution"], kind: "video" },
    { id: "MiniMax-Hailuo-2.3-Fast", name: "MiniMax Hailuo 2.3 Fast", params: ["duration","resolution"], kind: "video" },
    { id: "MiniMax-Hailuo-02", name: "MiniMax Hailuo 02", params: ["duration","resolution"], kind: "video" },
    { id: "speech-2.8-hd", name: "Speech 2.8 HD", kind: "tts" },
    { id: "speech-2.8-turbo", name: "Speech 2.8 Turbo", kind: "tts" },
    { id: "speech-2.6-hd", name: "Speech 2.6 HD", kind: "tts" },
    { id: "speech-2.6-turbo", name: "Speech 2.6 Turbo", kind: "tts" },
    { id: "speech-02-hd", name: "Speech 02 HD", kind: "tts" },
    { id: "speech-02-turbo", name: "Speech 02 Turbo", kind: "tts" },
    { id: "asr-1.0", name: "MiniMax ASR 1.0", kind: "stt" },
    { id: "music-3.0", name: "MiniMax Music 3.0", kind: "music" },
    { id: "music-2.6", name: "MiniMax Music 2.6", kind: "music" },
    { id: "music-cover", name: "MiniMax Music Cover", kind: "music" },
  ],
  serviceKinds: ["llm","image","tts","stt","video","music"],
  ttsConfig: { baseUrl: "https://api.minimax.io/v1/t2a_v2", authType: "apikey", authHeader: "bearer", format: "minimax-tts" },
  sttConfig: { baseUrl: "https://api.minimax.io/v1/speech_to_text", authType: "apikey", authHeader: "bearer", format: "minimax-stt" },
  musicConfig: { baseUrl: "https://api.minimax.io/v1/music_generation", authType: "apikey", authHeader: "bearer", format: "minimax-music" },
  /** MiniMax v2 and legacy async video task APIs, normalized by videoProviders/minimax.js. */
  videoConfig: {
    format: "minimax-multi",
    createUrl: "https://api.minimax.io/v2/video_generation",
    queryUrl: "https://api.minimax.io/v2/query/video_generation",
    defaultModel: "MiniMax-H3",
    models: ["MiniMax-H3", "MiniMax-H3-Max"],
    modelConstraints: {
      "MiniMax-H3": { resolutions: ["768P", "2K"], duration: { min: 4, max: 15 } },
      "MiniMax-H3-Max": { resolutions: ["480P", "768P"], duration: { min: 5, max: 15 } },
    },
    resolutions: ["480P", "768P", "2K"],
    duration: { min: 4, max: 15 },
    textToVideoRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    maxPromptCharacters: 7000,
    legacyCreateUrl: "https://api.minimax.io/v1/video_generation",
    legacyQueryUrl: "https://api.minimax.io/v1/query/video_generation",
    legacyFileRetrieveUrl: "https://api.minimax.io/v1/files/retrieve",
    legacyModels: ["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "MiniMax-Hailuo-02"],
    legacyT2vConstraints: {
      "MiniMax-Hailuo-2.3": { 6: ["768P", "1080P"], 10: ["768P"] },
      "MiniMax-Hailuo-02": { 6: ["768P", "1080P"], 10: ["768P"] },
    },
    legacyI2vConstraints: {
      "MiniMax-Hailuo-2.3": { 6: ["768P", "1080P"], 10: ["768P"] },
      "MiniMax-Hailuo-2.3-Fast": { 6: ["768P", "1080P"], 10: ["768P"] },
      "MiniMax-Hailuo-02": { 6: ["512P", "768P", "1080P"], 10: ["512P", "768P"] },
    },
  },
  // OmniRoute #7108: image_generation lives on the dedicated synchronous
  // endpoint (not the OpenAI-compatible /images/generations path).
  imageConfig: {
    baseUrl: "https://api.minimax.io/v1/image_generation",
    authType: "apikey",
    authHeader: "bearer",
    format: "minimax-image",
    models: [{ id: "image-01", name: "MiniMax Image-01" }],
    supportedSizes: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "1024x1024"],
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
