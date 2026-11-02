export default {
  id: "apmix",
  alias: "apmix",
  display: {
    name: "Apmix",
    icon: "route",
    color: "#F97316",
    textIcon: "AP",
    website: "https://apmix.ai",
    notice: {
      text: "Subscription gateway (apx_live_ keys). The catalog is plan-scoped per key and discovered from /v1/models.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.apmix.ai/v1/chat/completions",
    validateUrl: "https://api.apmix.ai/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.apmix.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.apmix.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [],
  modelsFetcher: { url: "https://api.apmix.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
