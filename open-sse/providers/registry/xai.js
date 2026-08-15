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
  transport: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    validateUrl: "https://api.x.ai/v1/models",
    responsesUrl: "https://api.x.ai/v1/responses",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
  },
  transports: [
    { format: "openai-responses-oauth", baseUrl: "https://api.x.ai/v1/responses" },
  ],
  models: [
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "grok-4.3", name: "Grok 4.3" },
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning" },
    { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 Non-Reasoning" },
    // Port of OmniRoute#6709 (decolua/9router#2439, author: @ryanngit): xAI
    // serves this id exclusively over its native /v1/responses endpoint. The
    // targetFormat tag is the single source of truth — chatCore translates the
    // body to openai-responses and XaiExecutor.buildUrl reads the same tag to
    // pick transport.responsesUrl.
    { id: "grok-4.20-multi-agent-0309", name: "Grok 4.20 Multi Agent", targetFormat: "openai-responses" },
    { id: "grok-build-0.1", name: "Grok Build 0.1" },
    // xAI renamed grok-code-fast-1; retain the catalog id as a wire alias so
    // existing user configs keep working without duplicating model behavior.
    { id: "grok-code-fast-1", name: "Grok Code Fast 1 (alias)", upstreamModelId: "grok-build-0.1" },
    { id: "grok-imagine-image-quality", name: "Grok Imagine Image Quality", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image-2.0", name: "Grok Imagine Image 2.0", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image", name: "Grok Imagine Image", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", params: ["duration","aspect_ratio","resolution"], kind: "video" },
    { id: "grok-imagine-video", name: "Grok Imagine Video", params: ["duration","aspect_ratio","resolution"], kind: "video" },
  ],
  serviceKinds: ["llm","imageToText","webSearch","image","video"],
  imageConfig: { baseUrl: "https://api.x.ai/v1/images/generations", bodyFields: ["model","prompt","n","response_format"] },
  // Async video jobs (POST returns { request_id }, GET polls until done/failed).
  // Docs: https://docs.x.ai/developers/rest-api-reference/inference/videos
  videoConfig: { baseUrl: "https://api.x.ai/v1/videos" },
  features: {
    usage: true,
  },
  searchViaChat: {
    defaultModel: "grok-4.6",
    endpoint: "https://api.x.ai/v1/responses",
    pricingUrl: "https://x.ai/api#pricing",
  },
};
