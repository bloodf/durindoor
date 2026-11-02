export default {
  id: "opper",
  alias: "opper",
  display: {
    name: "Opper",
    icon: "route",
    color: "#F59E0B",
    textIcon: "OR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.opper.ai/v3/compat/chat/completions",
    validateUrl: "https://api.opper.ai/v3/compat/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.opper.ai/v3/compat/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
