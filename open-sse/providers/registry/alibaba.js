// Native video catalog ported from cheaper-inference/OmniRoute (MIT),
// c71f0065a7efe9230ec23b96a12253b050c4d7ad: open-sse/config/videoRegistry.ts.
// Request options follow open-sse/handlers/videoGeneration/dashscopeHandler.ts.
// Existing keys and chat transport are shared; video uses /v1/video/generations.
const videoModels = [
  ["happyhorse-1.1-i2v", "HappyHorse 1.1 I2V"],
  ["happyhorse-1.1-t2v", "HappyHorse 1.1 T2V"],
  ["happyhorse-1.1-r2v", "HappyHorse 1.1 R2V"],
  ["happyhorse-1.0-video-edit", "HappyHorse 1.0 Video Edit"],
  ["wan2.7-i2v-2026-04-25", "Wan 2.7 I2V (2026-04-25)"],
  ["wan2.6-i2v-flash", "Wan 2.6 I2V Flash"],
  ["wan2.7-t2v-2026-06-12", "Wan 2.7 T2V (2026-06-12)"],
  ["wan2.7-r2v-2026-06-12", "Wan 2.7 R2V (2026-06-12)"],
  ["wan2.7-videoedit", "Wan 2.7 Video Edit"],
].map(([id, name]) => ({
  id, name, kind: "video",
  params: ["resolution", ...(/i2v/.test(id) ? [] : ["ratio"]), "duration", "prompt_extend", "watermark", "seed", "shot_type"],
}));

export default {
  id: "alibaba",
  alias: "ali",
  uiAlias: "ali",
  display: {
    name: "Alibaba",
    icon: "cloud_queue",
    color: "#FF6600",
    textIcon: "AL",
    website: "https://bailian.console.alibabacloud.com/",
  },
  category: "apikey",
  transport: {
    quirks: { preserveCacheControl: true },
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    modelsUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
  },
  serviceKinds: ["llm", "video"],
  models: [
    ...videoModels,
    { id: "qwen-max", name: "Qwen Max" },
    { id: "qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "qwen-max-2025-01-25", name: "Qwen Max (2025-01-25)" },
    { id: "qwen-plus", name: "Qwen Plus" },
    { id: "qwen-plus-2025-07-14", name: "Qwen Plus (2025-07-14)" },
    { id: "qwen-turbo", name: "Qwen Turbo" },
    { id: "qwen-turbo-2025-11-01", name: "Qwen Turbo (2025-11-01)" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash" },
    { id: "qwq-plus", name: "QwQ Plus (Reasoning)" },
    { id: "qwq-32b", name: "QwQ 32B" },
    { id: "qwen3-32b", name: "Qwen3 32B" },
    { id: "qwen3-235b-a22b", name: "Qwen3 235B A22B" },
  ],
  modelsFetcher: { url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", type: "openai" },
  passthroughModels: true,
};
