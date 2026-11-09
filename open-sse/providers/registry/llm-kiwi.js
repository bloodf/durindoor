export default {
  id: "llm-kiwi",
  alias: "llmkiwi",
  display: {
    name: "LLM Kiwi",
    icon: "route",
    color: "#65A30D",
    textIcon: "LK",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.llm.kiwi/v1/chat/completions",
    validateUrl: "https://api.llm.kiwi/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.llm.kiwi/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
