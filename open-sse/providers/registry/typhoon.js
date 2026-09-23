export default {
  id: "typhoon",
  alias: "typhoon",
  display: {
    name: "Typhoon",
    icon: "public",
    color: "#7C3AED",
    textIcon: "TY",
    website: "https://docs.opentyphoon.ai",
    notice: {
      text: "Free API key with a 5 req/s and 200 req/m rate limit.",
      apiKeyUrl: "https://opentyphoon.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.opentyphoon.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    {
      id: "typhoon-v2.5-30b-a3b-instruct",
      name: "Typhoon v2.5 30B A3B Instruct",
      contextLength: 131072,
    },
  ],
  serviceKinds: ["llm"],
};
