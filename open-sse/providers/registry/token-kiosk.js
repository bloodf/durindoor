export default {
  id: "token-kiosk",
  alias: "tk",
  display: {
    name: "Token Kiosk",
    icon: "route",
    color: "#B45309",
    textIcon: "TK",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://agent-router.gaib.ai/v1/chat/completions",
    validateUrl: "https://agent-router.gaib.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://agent-router.gaib.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
