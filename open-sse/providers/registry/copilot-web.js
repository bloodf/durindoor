export default {
  id: "copilot-web",
  priority: 238,
  alias: "copilot-web",
  uiAlias: "copilot",
  display: {
    name: "Copilot Web",
    icon: "auto_awesome",
    color: "#0078D4",
    textIcon: "CP",
    website: "https://copilot.microsoft.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the Copilot web access_token or import a logged-in browser HAR.",
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "wss://copilot.microsoft.com/c/api/chat?api-version=2",
    format: "openai",
    executor: "copilot-web",
    authType: "cookie",
  },
  models: [
    { id: "copilot-pro", name: "Copilot Pro (web)" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo (via Copilot)" },
    { id: "gpt-4", name: "GPT-4 (via Copilot)" },
  ],
};
