export default {
  id: "xinference",
  priority: 73,
  alias: "xinference",
  display: {
    name: "XInference",
    icon: "hub",
    color: "#DC2626",
    textIcon: "XI",
    website: "https://inference.readthedocs.io",
  },
  category: "apikey",
  authType: "apikey",
  noAuth: true,
  authHint: "API key optional. Configure the local XInference OpenAI-compatible base URL (default: http://localhost:9997/v1).",
  transport: {
    baseUrl: "http://localhost:9997/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
