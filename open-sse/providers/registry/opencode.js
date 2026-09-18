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
    // OpenCode Free 400s muse-spark-1.3-contributor-free when tool_choice is
    // anything but "auto" (port of decolua/9router aa14ef72).
    quirks: {
      forceAutoToolChoiceModels: ["muse-spark-1.3-contributor-free"],
    },
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
