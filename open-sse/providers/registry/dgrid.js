export default {
  id: "dgrid",
  alias: "dgrid",
  display: {
    name: "DGrid AI",
    icon: "grid_view",
    color: "#16A34A",
    textIcon: "DG",
    website: "https://dgrid.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.dgrid.ai/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.dgrid.ai/v1/models",
    defaultContextLength: 128000,
  },
  models: [
    { id: "dgridai/free", name: "DGrid Free Models Router" },
  ],
  modelsFetcher: { url: "https://api.dgrid.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
