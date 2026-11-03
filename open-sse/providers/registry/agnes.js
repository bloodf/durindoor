export default {
  id: "agnes",
  alias: "agnes",
  display: {
    name: "Agnes",
    icon: "route",
    color: "#2563EB",
    textIcon: "AG",
    notice: {
      text: "Agnes Flash models with reasoning effort levels; catalog from the public /v1/models endpoint.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
  },
  models: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", contextLength: 262144, supportsVision: true },
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextLength: 524288, supportsVision: true },
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash", contextLength: 524288, supportsVision: true },
  ],
  modelsFetcher: { url: "https://apihub.agnes-ai.com/v1/models", type: "openai" },
  serviceKinds: ["llm"],
};
