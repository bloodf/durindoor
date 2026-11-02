export default {
  id: "openvecta",
  alias: "openvecta",
  display: {
    name: "OpenVecta",
    icon: "route",
    color: "#7C3AED",
    textIcon: "OV",
    website: "https://openvecta.com",
    notice: {
      text: "Third-party gateway; review the provider's terms before use.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.openvecta.com/v1/chat/completions",
    validateUrl: "https://api.openvecta.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.openvecta.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
