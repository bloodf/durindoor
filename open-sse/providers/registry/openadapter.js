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
    // Canonical GLM-4.7 context is 200000 (see capabilities.js MODEL_CAPABILITIES
    // "glm-4.7"); OpenAdapter's own docs cap the served context at 128000, so
    // declare it per-model rather than inheriting the wider canonical window.
    { id: "glm-4.7", name: "GLM 4.7 (OpenAdapter)", contextLength: 128000, toolCalling: true },
  ],
  modelsFetcher: { url: "https://api.openadapter.in/v1/models", type: "openai" },
  defaultContextLength: 128000,
};
