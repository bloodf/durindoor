export default {
  id: "copilot-m365-web",
  priority: 237,
  alias: "m365copilot",
  uiAlias: "m365",
  display: {
    name: "Microsoft 365 Copilot Web",
    icon: "business",
    color: "#7C3AED",
    textIcon: "M365",
    website: "https://m365.cloud.microsoft/chat",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Copy the Chathub WebSocket path and access_token from m365.cloud.microsoft/chat.",
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "wss://substrate.office.com/m365Copilot/Chathub",
    format: "openai",
    executor: "copilot-m365-web",
    authType: "cookie",
  },
  models: [{ id: "copilot-m365", name: "Microsoft 365 Copilot (BizChat)" }],
};
