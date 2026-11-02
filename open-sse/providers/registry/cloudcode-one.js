export default {
  id: "cloudcode-one",
  alias: "cloudcode-one",
  display: {
    name: "CloudCode.ONE",
    icon: "route",
    color: "#0891B2",
    textIcon: "CC",
    website: "https://cloudcode.one",
    notice: {
      text: "OpenAI-compatible API with published free model aliases. Its separate Anthropic-compatible endpoint is not covered.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.cloudcode.one/v1/chat/completions",
    validateUrl: "https://api.cloudcode.one/v1/models",
  },
  models: [
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "glm-4.6v-flash", name: "GLM 4.6V Flash" },
  ],
  modelsFetcher: { url: "https://api.cloudcode.one/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
