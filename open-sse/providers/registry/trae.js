export default {
  id: "trae",
  priority: 100,
  display: {
    name: "Trae",
    icon: "code",
    color: "#111827",
    textIcon: "TR",
    website: "https://trae.ai",
  },
  category: "oauth",
  transport: {
    baseUrl: "https://core-normal.trae.ai/api/remote/v1",
    format: "openai",
    defaultContextLength: 200000,
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "raw",
    },
  },
  oauth: {
    flowType: "import_token",
    apiEndpoint: "https://core-normal.trae.ai/api/remote/v1",
    chatEndpoint: "https://core-normal.trae.ai/api/remote/v1/chat_sessions",
    webUrl: "https://solo.trae.ai",
    tokenLifetimeDays: 14,
  },
};
