export default {
  id: "hetzner",
  alias: "hetzner",
  display: {
    name: "Hetzner Inference",
    icon: "cloud",
    color: "#D50C2D",
    textIcon: "HZ",
    website: "https://www.hetzner.com",
    notice: {
      text: "Hetzner Inference is experimental. Discover available models using your API token.",
      apiKeyUrl: "https://experiments.hetzner.com/",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.hetzner.com/api/v1/chat/completions",
    validateUrl: "https://inference.hetzner.com/api/v1/models",
    format: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://inference.hetzner.com/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
