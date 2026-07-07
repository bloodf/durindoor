export default {
  id: "hcnsec",
  priority: 70,
  alias: "hcnsec",
  display: {
    name: "Huancheng Public API",
    icon: "security",
    color: "#0EA5E9",
    textIcon: "HC",
    website: "https://api.hcnsec.cn",
    notice: {
      text: "Xinjiang Huancheng Cybersecurity public LLM API platform: free credits with daily check-ins.",
      apiKeyUrl: "https://api.hcnsec.cn",
    },
  },
  category: "free",
  hasFree: true,
  authType: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
    format: "openai",
    auth: {
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "step-image-edit-2", name: "Step Image Edit 2 (Huancheng)", type: "image", params: ["size"] },
  ],
  serviceKinds: ["llm", "image"],
};
