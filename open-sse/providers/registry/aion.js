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
      text: "Free key from aionlabs.ai, 20k tokens/day on the free tier.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.aionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.aionlabs.ai/v1/models",
  },
  models: [
    { id: "aion-labs/aion-3.0", name: "Aion 3.0", contextLength: 131072 },
    { id: "aion-labs/aion-3.0-mini", name: "Aion 3.0 Mini", contextLength: 131072 },
    { id: "aion-labs/aion-2.5", name: "Aion 2.5", contextLength: 131072 },
    { id: "aion-labs/aion-2.0", name: "Aion 2.0", contextLength: 131072 },
    { id: "aion-labs/aion-rp-llama-3.1-8b", name: "Aion RP Llama 3.1 8B", contextLength: 32768 },
  ],
  modelsFetcher: { url: "https://api.aionlabs.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
