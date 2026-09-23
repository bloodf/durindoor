export default {
  id: "xiaomi-mimo-token-plan",
  alias: "mimotp",
  display: {
    name: "Xiaomi MiMo Token Plan",
    icon: "devices",
    color: "#EA580C",
    textIcon: "MT",
    website: "https://mimo.mi.com",
    notice: {
      apiKeyUrl: "https://platform.xiaomimimo.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", contextLength: 1048576, maxOutputTokens: 131072 },
    { id: "mimo-v2.5", name: "MiMo-V2.5", contextLength: 1048576, maxOutputTokens: 131072 },
  ],
  serviceKinds: ["llm"],
};
