export default {
  id: "nlpcloud",
  alias: "nlpc",
  hidden: true,
  display: {
    name: "NLP Cloud",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "NC",
    website: "https://nlpcloud.com",
    notice: { apiKeyUrl: "https://nlpcloud.com/home/playground/api-keys" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.nlpcloud.io/v1/chat/completions",
  },
  // NLP Cloud chat uses model-scoped chatbot endpoints, not an OpenAI-compatible
  // chat-completions route. Keep hidden until a native executor maps that API.
  models: [],
};
