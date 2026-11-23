export default {
  id: "canopywave",
  alias: "cwv",
  display: { name: "CanopyWave", icon: "cloud", color: "#0EA5E9", website: "https://canopywave.com", notice: { apiKeyUrl: "https://canopywave.com" } },
  category: "apikey",
  authType: "apikey",
  transport: { baseUrl: "https://inference.canopywave.io/v1/chat/completions", validateUrl: "https://inference.canopywave.io/v1/models" },
  models: [
    { id: "xiaomimimo/mimo-v2.5", name: "xiaomimimo/mimo-v2.5" },
    { id: "moonshotai/kimi-k2.6", name: "moonshotai/kimi-k2.6" },
    { id: "deepseek/deepseek-v4-flash", name: "deepseek/deepseek-v4-flash" },
    { id: "minimax/minimax-m2.5", name: "minimax/minimax-m2.5" },
    { id: "zai/glm-5.1", name: "zai/glm-5.1" },
  ],
  modelsFetcher: { url: "https://inference.canopywave.io/v1/models", type: "openai" },
  serviceKinds: ["llm"],
};
