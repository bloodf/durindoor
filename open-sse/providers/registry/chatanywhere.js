export default {
  id: "chatanywhere",
  alias: "chatanywhere",
  display: {
    name: "ChatAnywhere",
    icon: "route",
    color: "#16A34A",
    textIcon: "CA",
    notice: {
      text: "International endpoint. Free access is limited to non-commercial use; this is a resale-style gateway, review its terms before relying on it.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.chatanywhere.org/v1/chat/completions",
    validateUrl: "https://api.chatanywhere.org/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.chatanywhere.org/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
