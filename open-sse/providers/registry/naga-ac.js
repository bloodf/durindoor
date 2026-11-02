export default {
  id: "naga-ac",
  alias: "naga",
  display: {
    name: "Naga.ac",
    icon: "route",
    color: "#0EA5E9",
    textIcon: "NG",
    website: "https://docs.naga.ac",
    notice: {
      text: "Third-party gateway; review the provider's terms before use. Free tier may permit data collection or training.",
    },
  },
  category: "apikey",
  authType: "optional",
  transport: {
    baseUrl: "https://api.naga.ac/v1/chat/completions",
    validateUrl: "https://api.naga.ac/v1/models",
    authHeader: "bearer",
  },
  models: [],
  modelsFetcher: { url: "https://api.naga.ac/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
