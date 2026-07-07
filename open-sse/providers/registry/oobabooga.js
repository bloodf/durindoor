export default {
  id: "oobabooga",
  priority: 74,
  alias: "ooba",
  uiAlias: "ooba",
  display: {
    name: "oobabooga",
    icon: "dns",
    color: "#8B5CF6",
    textIcon: "OO",
    website: "https://github.com/oobabooga/text-generation-webui",
  },
  category: "apikey",
  authType: "apikey",
  noAuth: true,
  authHint: "API key optional. Configure the local oobabooga OpenAI-compatible base URL (default: http://localhost:5000/v1).",
  transport: {
    baseUrl: "http://localhost:5000/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
