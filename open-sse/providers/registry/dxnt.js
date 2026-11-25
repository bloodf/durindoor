export default {
  id: "dxnt",
  alias: "dxnt",
  display: {
    name: "DXNT",
    icon: "route",
    color: "#2563EB",
    textIcon: "DX",
    notice: {
      text: "The signup bonus exists, but no model accepts it (checked 2026-11-23). The catalog comes from the authenticated /v1/models endpoint.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://www.dxnt.com/v1/chat/completions",
    validateUrl: "https://www.dxnt.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://www.dxnt.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
