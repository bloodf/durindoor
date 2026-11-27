// Staged only. Derived from MIT-licensed OmniRoute PR #21441,
// open-sse/config/providers/registry/ttoken/index.ts at 7ec5270551bdda0c0a692c7aea9b9ee0fd0ccc77.
export default {
  id: "ttoken",
  alias: "ttoken",
  uiAlias: "ttoken",
  display: {
    name: "TTOken", icon: "hub", textIcon: "TT", website: "https://ttoken.dev",
    notice: { apiKeyUrl: "https://ttoken.dev/dashboard/keys" },
  },
  category: "apikey",
  authType: "apikey",
  authHint: "Create a Gateway product API key at https://ttoken.dev/dashboard/keys.",
  transport: {
    baseUrl: "https://api.ttoken.dev/v1/chat/completions",
    validateUrl: "https://api.ttoken.dev/v1/models",
  },
  modelsFetcher: { url: "https://api.ttoken.dev/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
  models: [
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B" },
    { id: "netra/deepseek-v4.1-flash-netra", name: "DeepSeek V4.1 Flash (Netra)" },
    { id: "ttoken/auto", name: "TTOken Auto" },
  ],
};
