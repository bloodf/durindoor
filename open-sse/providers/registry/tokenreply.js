export default {
  id: "tokenreply",
  alias: "tokenreply",
  display: {
    name: "TokenReply",
    icon: "route",
    color: "#9333EA",
    textIcon: "TR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.tokenreply.com/v1/chat/completions",
    validateUrl: "https://api.tokenreply.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.tokenreply.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
