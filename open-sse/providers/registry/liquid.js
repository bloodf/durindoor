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
    baseUrl: "https://api.liquid.ai/v1/chat/completions",
    validateUrl: "https://api.liquid.ai/v1/models",
    authHeader: "bearer",
  },
  models: [{ id: "liquid-lfm-40b", name: "Liquid LFM 40B" }],
  serviceKinds: ["llm"],
};
