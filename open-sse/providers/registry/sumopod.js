export default {
  id: "sumopod",
  alias: "sumopod",
  display: {
    name: "SumoPod",
    icon: "router",
    color: "#2563EB",
    textIcon: "SP",
    website: "https://ai.sumopod.com",
    notice: {
      text: "Fully OpenAI-compatible gateway with a live /v1/models catalog.",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ai.sumopod.com/v1/chat/completions",
    validateUrl: "https://ai.sumopod.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://ai.sumopod.com/v1/models", type: "openai" },
  passthroughModels: true,
  defaultContextLength: 128000,
};
