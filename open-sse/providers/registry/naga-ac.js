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
      text: "Free models accept an optional API key; authenticated users get higher rate limits. Free tier may permit data collection or training; check the terms.",
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
