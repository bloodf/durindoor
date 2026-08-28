export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  autoComboNoAuth: true,
  // Gateway-wide effort enum; model-scoped capability metadata may narrow it.
  thinkingFormat: "opencode",
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
  },
  models: [
    { id: "x-preview-f-free", name: "Ox Alpha Free", targetFormat: "openai", supportedFormats: ["openai"] },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
