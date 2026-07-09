export default {
  id: "kimi-web",
  priority: 210,
  alias: "kimi-web",
  display: {
    name: "Kimi Web",
    icon: "chat",
    color: "#3B82F6",
    textIcon: "KW",
    website: "https://www.kimi.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the full Cookie header from www.kimi.com (must contain kimi-auth=<JWT>).",
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat",
    format: "kimi-web",
    executor: "kimi-web",
    authType: "cookie",
  },
  models: [
    { id: "k2d6", name: "K2.6 Instant" },
    { id: "k2d6-thinking", name: "K2.6 Thinking", supportsReasoning: true },
  ],
};
