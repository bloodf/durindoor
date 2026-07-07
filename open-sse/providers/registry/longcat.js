export default {
  id: "longcat",
  priority: 70,
  alias: "lc",
  display: {
    name: "LongCat",
    icon: "message-square",
    color: "#F59E0B",
    textIcon: "LC",
    website: "https://longcat.chat",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.longcat.chat/openai/v1/chat/completions",
    validateUrl: "https://api.longcat.chat/openai/v1/models",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    {
      id: "LongCat-2.0",
      name: "LongCat 2.0 (10M tok free)",
      contextLength: 1048576,
    },
  ],
  serviceKinds: ["llm"],
};
