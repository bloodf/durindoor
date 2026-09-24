export default {
  id: "ant-ling",
  alias: "ling",
  display: {
    name: "Ant Ling / Ring (inclusionAI)",
    icon: "auto_awesome",
    color: "#1677FF",
    textIcon: "AL",
    website: "https://developer.ant-ling.com/en/docs/",
    notice: {
      text: "500,000 free tokens per day per account (resets 02:00 UTC+8, no rollover).",
      apiKeyUrl: "https://chat.ant-ling.com/open",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.ant-ling.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "Ling-2.6-1T", name: "Ling 2.6 1T" },
    { id: "Ring-2.6-1T", name: "Ring 2.6 1T" },
    { id: "Ling-2.6-flash", name: "Ling 2.6 Flash" },
  ],
  serviceKinds: ["llm"],
};
