export default {
  id: "zylo-api",
  alias: "zylo",
  display: {
    name: "Zylo API",
    icon: "route",
    color: "#7C2D12",
    textIcon: "ZY",
    notice: {
      text: "Public /v1/models uses a non-standard {text:[...]} shape; no model fetcher is configured.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.zyloai.net/v1/chat/completions",
    validateUrl: "https://api.zyloai.net/v1/models",
  },
  models: [],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
