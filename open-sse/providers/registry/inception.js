export default {
  id: "inception",
  alias: "inception",
  display: {
    name: "Inception",
    icon: "auto_awesome",
    color: "#F97316",
    textIcon: "IN",
    website: "https://docs.inceptionlabs.ai",
    notice: {
      text: "10M free tokens on signup, no credit card required.",
      apiKeyUrl: "https://inceptionlabs.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    {
      id: "mercury-2",
      name: "Mercury 2",
      contextLength: 128000,
      maxOutputTokens: 50000,
    },
  ],
  serviceKinds: ["llm"],
};
