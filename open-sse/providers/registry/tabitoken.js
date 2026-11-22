// Staged TabiToken port from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/tabitoken/index.ts.
// TabiToken exposes NewAPI's Claude and OpenAI compatible endpoints.
export default {
  id: "tabitoken",
  alias: "tabitoken",
  display: {
    name: "TabiToken",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "TT",
    website: "https://tabitoken.com",
    notice: {
      apiKeyUrl: "https://tabitoken.com/",
      text: "Uses TabiToken's Claude-compatible Messages endpoint. Current model access and pricing are controlled by TabiToken.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://tabitoken.com/v1/messages",
    format: "claude",
    validateUrl: "https://tabitoken.com/v1/models",
    authType: "apikey",
    authHeader: "x-api-key",
    headers: { "anthropic-version": "2023-06-01" },
  },
  models: [
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-5-thinking", name: "Claude Opus 5 Thinking" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4-8-thinking", name: "Claude Opus 4.8 Thinking" },
  ],
  modelsFetcher: { url: "https://tabitoken.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
