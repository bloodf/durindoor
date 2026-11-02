export default {
  id: "dahl",
  alias: "dahl",
  display: {
    name: "Dahl",
    icon: "route",
    color: "#9333EA",
    textIcon: "DA",
    notice: {
      text: "Free inference. Mint a key with POST https://inference.dahl.global/tokens (response has a token field) and paste it here.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.dahl.global/v1/chat/completions",
    validateUrl: "https://inference.dahl.global/v1/models",
    defaultContextLength: 200000,
  },
  models: [],
  modelsFetcher: { url: "https://inference.dahl.global/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
