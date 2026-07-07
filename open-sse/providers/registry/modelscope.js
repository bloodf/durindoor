export default {
  id: "modelscope",
  alias: "ms",
  display: {
    name: "ModelScope",
    icon: "hub",
    color: "#00A0E9",
    textIcon: "MS",
    website: "https://modelscope.cn",
    notice: { apiKeyUrl: "https://modelscope.cn/my/myaccesstoken" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.cn/v1/models",
    // Multi-family OpenAI-compatible passthrough: force the OpenAI reasoning
    // wire shape so Qwen/GLM thinking models don't emit family-native fields.
    thinkingFormat: "openai",
  },
  models: [],
  // type: "openai" reshapes the raw /v1/models list into { id, name } via
  // FILTERS.openai (suggested-models/filters.js) — shared by every provider
  // exposing a plain OpenAI-compatible model list (openadapter, novita, ...).
  modelsFetcher: { url: "https://api-inference.modelscope.cn/v1/models", type: "openai", provider: "modelscope" },
  passthroughModels: true,
};
