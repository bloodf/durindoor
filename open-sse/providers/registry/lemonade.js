export default {
  id: "lemonade",
  priority: 68,
  alias: "lemonade",
  display: {
    name: "Lemonade Server",
    icon: "lemonade.png",
    color: "#F59E0B",
    textIcon: "LM",
    website: "https://lemonade-server.ai",
  },
  category: "apikey",
  authType: "apikey",
  authHint: "API key optional. Configure the local Lemonade OpenAI-compatible base URL (default: http://localhost:13305/api/v1).",
  transport: {
    baseUrl: "http://localhost:13305/api/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
