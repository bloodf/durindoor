export default {
  id: "adapta-web",
  priority: 235,
  alias: "adp-web",
  uiAlias: "adp-web",
  display: {
    name: "Adapta Web",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "AD",
    website: "https://agent.adapta.one",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the .clerk.agent.adapta.one __client cookie value from agent.adapta.one.",
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://agent.adapta.one/api/chat/stream/v1",
    format: "openai",
    executor: "adapta-web",
    authType: "cookie",
  },
  models: [
    { id: "adapta-one", name: "Adapta ONE (Auto)" },
  ],
};
