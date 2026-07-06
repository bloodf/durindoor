export default {
  id: "digitalocean",
  priority: 80,
  alias: "digitalocean",
  aliases: [
    "do",
  ],
  uiAlias: "do",
  display: {
    name: "DigitalOcean",
    icon: "cloud",
    color: "#0060FF",
    textIcon: "DO",
    website: "https://docs.digitalocean.com/products/ai-platform/",
    notice: {
      text: "Use a DigitalOcean Personal Access Token (dop_v1_...) or a Model Access Key from the Inference console. OAuth tokens (doo_v1_...) may not have the required scopes.",
      apiKeyUrl: "https://cloud.digitalocean.com/account/api/tokens",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.do-ai.run/v1/chat/completions",
    validateUrl: "https://inference.do-ai.run/v1/models",
  },
  serviceKinds: ["llm"],
  passthroughModels: true,
};
