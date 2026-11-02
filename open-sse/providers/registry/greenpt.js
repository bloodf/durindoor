export default {
  id: "greenpt",
  alias: "greenpt",
  display: {
    name: "GreenPT",
    icon: "route",
    color: "#15803D",
    textIcon: "GP",
    notice: {
      text: "EU privacy-focused provider.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.greenpt.ai/v1/chat/completions",
    validateUrl: "https://api.greenpt.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.greenpt.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
