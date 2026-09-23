export default {
  id: "modelscope",
  alias: "ms",
  display: {
    name: "ModelScope",
    icon: "smart_toy",
    color: "#FF6A00",
    textIcon: "MS",
    website: "https://modelscope.cn",
    notice: {
      text: "Free tier via ModelScope API-Inference — Alibaba account required.",
      apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.cn/v1/models",
    format: "openai",
  },
  // ModelScope's open-model catalog moves too fast for a pinned list; discover live.
  models: [],
  modelsFetcher: { url: "https://api-inference.modelscope.cn/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
