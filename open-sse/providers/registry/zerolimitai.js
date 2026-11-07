export default {
  id: "zerolimitai",
  alias: "zerolimitai",
  display: {
    name: "ZeroLimit AI",
    icon: "route",
    color: "#6366F1",
    textIcon: "ZL",
    website: "https://www.zerolimitai.com",
    notice: {
      text: "Use auto for provider routing or discover current model ids. Requires an account API key.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://www.zerolimitai.com/api/v1/chat/completions",
    validateUrl: "https://www.zerolimitai.com/api/v1/models",
  },
  models: [{ id: "auto", name: "Auto" }],
  modelsFetcher: { url: "https://www.zerolimitai.com/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
