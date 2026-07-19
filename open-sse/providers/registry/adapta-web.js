export default {
  id: "adapta-web",
  priority: 235,
  alias: "adp-web",
  uiAlias: "adp-web",
  display: {
    name: "Adapta Web",
    icon: "adapta-web",
    color: "#2563EB",
    textIcon: "AD",
    website: "https://agent.adapta.one",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://agent.adapta.one/api/chat/stream/v1",
    format: "openai",
    executor: "adapta-web",
    auth: {
      apiKey: {
        header: "Authorization",
        scheme: "bearer",
      },
    },
  },
  models: [
    { id: "adapta-one", name: "Adapta ONE (Auto)" },
    { id: "adapta-gpt", name: "GPT-5 (via Adapta)" },
    { id: "adapta-claude", name: "Claude Sonnet 4.6 (via Adapta)" },
    { id: "adapta-gemini", name: "Gemini 2.5 Pro (via Adapta)" },
    { id: "adapta-grok", name: "Grok 4 (via Adapta)" },
    { id: "adapta-deepseek", name: "DeepSeek R2 (via Adapta)" },
    { id: "adapta-llama", name: "Llama 4 (via Adapta)" },
  ],
};
