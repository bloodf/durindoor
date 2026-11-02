export default {
  id: "regolo",
  alias: "regolo",
  display: {
    name: "Regolo",
    icon: "route",
    color: "#0D9488",
    textIcon: "RG",
    notice: {
      text: "EU-hosted OpenAI-compatible inference.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.regolo.ai/v1/chat/completions",
    validateUrl: "https://api.regolo.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.regolo.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
