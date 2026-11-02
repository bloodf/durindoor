export default {
  id: "agnes-cn",
  alias: "agnescn",
  display: {
    name: "Agnes (China)",
    icon: "route",
    color: "#DC2626",
    textIcon: "AC",
    notice: {
      text: "China-region Agnes endpoint; behaves like the international endpoint but /v1/models needs a key.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.agnes-ai.cn/v1/chat/completions",
    validateUrl: "https://api.agnes-ai.cn/v1/models",
  },
  models: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", contextLength: 262144, supportsVision: true },
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextLength: 524288, supportsVision: true },
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash", contextLength: 524288, supportsVision: true },
  ],
  modelsFetcher: { url: "https://api.agnes-ai.cn/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
