export default {
  id: "openadapter",
  alias: "oad",
  display: {
    name: "OpenAdapter",
    icon: "route",
    color: "#4F46E5",
    textIcon: "OA",
    website: "https://docs.openadapter.dev",
    notice: {
      text: "Subscription gateway exposing 70+ open models through one OpenAI-compatible endpoint.",
    },
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
  passthroughModels: true,
  serviceKinds: ["llm"],
};
