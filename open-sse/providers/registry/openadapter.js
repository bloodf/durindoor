export default {
  id: "openadapter",
  alias: "oad",
  display: {
    name: "OpenAdapter",
    icon: "extension",
    color: "#06B6D4",
    textIcon: "OA",
    website: "https://docs.openadapter.dev",
    notice: { apiKeyUrl: "https://docs.openadapter.dev" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.openadapter.in/v1/chat/completions",
    validateUrl: "https://api.openadapter.in/v1/models",
  },
  models: [
    { id: "glm-4.7", name: "GLM 4.7 (OpenAdapter)", contextLength: 128000, toolCalling: true },
  ],
  modelsFetcher: { url: "https://api.openadapter.in/v1/models", type: "openai" },
  defaultContextLength: 128000,
};
