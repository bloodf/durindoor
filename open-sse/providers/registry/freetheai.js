export default {
  id: "freetheai",
  alias: "fta",
  display: {
    name: "FreeTheAi",
    icon: "route",
    color: "#6366F1",
    textIcon: "FT",
    notice: {
      text: "Free-tier gateway with unknown upstream resale. Model ids are namespaced and must be sent in full (fta/zai/glm-5.3). The live /v1/models list is authoritative after the first sync.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.freetheai.org/v1/chat/completions",
    validateUrl: "https://api.freetheai.org/v1/models",
    defaultContextLength: 128000,
  },
  models: [
    { id: "fta/zai/glm-5.3", name: "GLM 5.3 (zai)" },
    { id: "fta/kimi/k3", name: "Kimi K3" },
  ],
  modelsFetcher: { url: "https://api.freetheai.org/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
