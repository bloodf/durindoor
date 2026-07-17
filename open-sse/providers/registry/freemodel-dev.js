export default {
  id: "freemodel-dev",
  alias: "fmd",
  display: {
    name: "FreeModel.dev",
    icon: "deployed_code",
    color: "#0891B2",
    textIcon: "FM",
    website: "https://freemodel.dev",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.freemodel.dev/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.freemodel.dev/v1/models",
    defaultContextLength: 128000,
  },
  models: [
    { id: "gpt-5.5", name: "GPT-5.5", contextLength: 400000 },
    { id: "gpt-5.4", name: "GPT-5.4", contextLength: 400000 },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  ],
  modelsFetcher: { url: "https://api.freemodel.dev/v1/models", type: "openai" },
  passthroughModels: true,
};
