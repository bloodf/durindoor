export default {
  id: "aion",
  alias: "aion",
  display: {
    name: "Aion Labs",
    icon: "route",
    color: "#0EA5E9",
    textIcon: "AI",
    website: "https://aionlabs.ai",
    notice: {
      text: "Free tier of about 20k tokens/day; activating it requires verifying a payment card, which is never charged (checked 2026-11-23).",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.aionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.aionlabs.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.aionlabs.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
