export default {
  id: "replicate",
  alias: "replicate",
  display: {
    name: "Replicate",
    icon: "smart_toy",
    color: "#111111",
    textIcon: "R",
    website: "https://replicate.com",
    notice: { apiKeyUrl: "https://replicate.com/account/api-tokens" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.replicate.com/v1",
    validateUrl: "https://api.replicate.com/v1/account",
    format: "openai",
  },
  models: [{ id: "meta/meta-llama-3-70b-instruct", name: "Llama 3 70B Instruct" }],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
