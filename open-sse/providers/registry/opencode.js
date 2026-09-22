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
    // Upstream #4041-adjacent cluster: Zen 403s (FreeTierError) on
    // non-streaming free-tier requests. Force stream upstream; chatCore
    // aggregates the SSE back to JSON for clients that asked for JSON.
    forceStream: true,
    // OpenCode Free 400s the Muse Spark contributor models when tool_choice is
    // anything but "auto" (port of decolua/9router aa14ef72; 1.2 added by
    // upstream #4165, which found the same constraint on that model).
    quirks: {
      forceAutoToolChoiceModels: [
        "muse-spark-1.2-contributor-free",
        "muse-spark-1.3-contributor-free",
      ],
    },
  },
  models: [
    { id: "x-preview-f-free", name: "Ox Alpha Free", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
