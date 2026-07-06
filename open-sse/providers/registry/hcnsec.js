export default {
  id: "hcnsec",
  priority: 90,
  alias: "hcnsec",
  display: {
    name: "Huancheng Public API",
    icon: "security",
    color: "#0EA5E9",
    textIcon: "HC",
    website: "https://api.hcnsec.cn",
    notice: {
      text: "Xinjiang Huancheng Cybersecurity public LLM API platform with free credits from daily check-ins.",
      apiKeyUrl: "https://api.hcnsec.cn",
    },
  },
  category: "apikey",
  hasFree: true,
  authType: "apikey",
  passthroughModels: true,
  modelsFetcher: { url: "https://api.hcnsec.cn/v1/models", type: "openai" },
  transport: {
    baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
    format: "openai",
    validateUrl: "https://api.hcnsec.cn/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [],
  serviceKinds: ["llm"],
};