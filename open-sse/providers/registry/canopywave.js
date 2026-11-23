export default {
  id: "canopywave",
  alias: "cwv",
  display: { name: "CanopyWave", icon: "cloud", color: "#15B8A6", textIcon: "CW", website: "https://canopywave.io", notice: { apiKeyUrl: "https://canopywave.io" } },
  category: "apikey",
  authType: "apikey",
  transport: { baseUrl: "https://inference.canopywave.io/v1/chat/completions", validateUrl: "https://inference.canopywave.io/v1/models" },
  models: [
    { id: "xiaomimimo/mimo-v2.5", name: "Xiaomi MiMo V2.5" },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "minimax/minimax-m2.5", name: "MiniMax M2.5" },
    { id: "zai/glm-5.1", name: "GLM 5.1" },
  ],
  modelsFetcher: { url: "https://inference.canopywave.io/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
