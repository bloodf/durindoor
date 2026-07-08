export default {
  id: "glhf",
  alias: "glhf",
  display: {
    name: "GLHF",
    icon: "sports_esports",
    color: "#9333EA",
    textIcon: "GH",
    website: "https://glhf.chat",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://glhf.chat/api/openai/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://glhf.chat/api/openai/v1/models",
  },
  models: [
    { id: "hf:mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B Instruct (HF)" },
  ],
  modelsFetcher: { url: "https://glhf.chat/api/openai/v1/models", type: "openai" },
  passthroughModels: true,
};
