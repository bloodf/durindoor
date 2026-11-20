// OmniRoute release/v3.8.55: open-sse/config/providers/registry/arcee-ai/index.ts.
// This identity is separate from DurinDoor's existing Conductor connection.
export default {
  id: "arcee-platform",
  alias: "arcee-platform",
  display: {
    name: "Arcee Platform",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "AR",
    website: "https://platform.arcee.ai",
    notice: {
      text: "Use an Arcee Platform API key. Arcee Conductor connections use a separate endpoint and key.",
      apiKeyUrl: "https://platform.arcee.ai/api/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.arcee.ai/api/v1/chat/completions",
    validateUrl: "https://api.arcee.ai/api/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.arcee.ai/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
