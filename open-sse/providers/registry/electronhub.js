export default {
  id: "electronhub",
  alias: "electronhub",
  display: {
    name: "Electron Hub",
    icon: "route",
    color: "#EAB308",
    textIcon: "EH",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.electronhub.ai/v1/chat/completions",
    validateUrl: "https://api.electronhub.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.electronhub.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
