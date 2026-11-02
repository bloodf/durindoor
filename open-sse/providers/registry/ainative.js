export default {
  id: "ainative",
  alias: "ainative",
  display: {
    name: "AINative Studio",
    icon: "route",
    color: "#7C3AED",
    textIcon: "AN",
    notice: {
      text: "OpenAI-compatible aggregator; the public catalog is discovered live.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ainative.studio/api/v1/chat/completions",
    validateUrl: "https://api.ainative.studio/api/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.ainative.studio/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
