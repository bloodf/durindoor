export default {
  id: "baichuan",
  alias: "baichuan",
  uiAlias: "baichuan",
  display: {
    name: "Baichuan",
    icon: "baichuan",
    color: "#6366F1",
    textIcon: "BC",
    website: "https://baichuan.com",
    notice: {
      text: "Free Baichuan models. Popular Chinese LLM startup.",
      apiKeyUrl: "https://platform.baichuan-ai.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.baichuan-ai.com/v1/chat/completions",
  },
  models: [
    { id: "Baichuan4-Turbo", name: "Baichuan 4 Turbo", contextLength: 32768 },
    { id: "Baichuan4-Air", name: "Baichuan 4 Air", contextLength: 32768 },
    { id: "Baichuan4", name: "Baichuan 4" },
    { id: "Baichuan3-Turbo", name: "Baichuan 3 Turbo", contextLength: 32768 },
    { id: "Baichuan3-Turbo-128k", name: "Baichuan 3 Turbo 128k", contextLength: 131072 },
  ],
};
