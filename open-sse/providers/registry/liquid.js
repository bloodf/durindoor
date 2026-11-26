// OpenAI-compatible chat and discovery: https://docs.liquid.ai/api/quickstart
export default {
  id: "liquid",
  priority: 70,
  alias: "liquid",
  display: {
    name: "Liquid AI",
    icon: "droplets",
    color: "#06B6D4",
    textIcon: "LQ",
    website: "https://www.liquid.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.liquid.ai/openai/v1/chat/completions",
    validateUrl: "https://api.liquid.ai/openai/v1/models",
    authHeader: "bearer",
  },
  models: [
    { id: "lfm3-1.7b", name: "LFM3 1.7B" },
    { id: "lfm3-vl-2b", name: "LFM3 VL 2B" },
    { id: "lfm2.5-24b-a2b", name: "LFM2.5 24B A2B" },
  ],
  modelsFetcher: { url: "https://api.liquid.ai/openai/v1/models", type: "openai" },
  serviceKinds: ["llm"],
};
