// TypeSafe's native System One API; these are decisions, not chat completions.
// Model IDs and moving aliases: https://docs.typesafe.ai/models
export default {
  id: "typesafe",
  alias: "jev",
  priority: 60,
  display: {
    name: "TypeSafe (Jev)",
    icon: "rule",
    textIcon: "JEV",
    color: "#5262d6",
    website: "https://typesafe.ai",
    notice: {
      text: "Jev evaluates typed choice, score, and yes/no questions over text or structured state. Use /v1/systemone, not chat endpoints. An eligible TypeSafe API key is required.",
      apiKeyUrl: "https://typesafe.ai",
    },
  },
  category: "apikey",
  transport: null,
  serviceKinds: ["systemone"],
  models: [
    { id: "jev-latest", name: "Jev Latest", kind: "systemone" },
    { id: "jev-preview", name: "Jev Preview", kind: "systemone" },
    { id: "jev-1.13.0", name: "Jev 1.13.0", kind: "systemone" },
  ],
  modelsFetcher: { url: "https://api.typesafe.ai/v1/models", type: "systemone" },
  systemoneConfig: {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    inputPricePerMTok: 0.042,
    outputPricePerMTok: 0,
  },
};
