export default {
  id: "sarvam",
  alias: "sarvam",
  display: {
    name: "Sarvam AI",
    icon: "public",
    color: "#0EA5E9",
    textIcon: "SV",
    website: "https://docs.sarvam.ai",
    notice: {
      text: "₹1,000 in free signup credits — never expire.",
      apiKeyUrl: "https://dashboard.sarvam.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.sarvam.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "sarvam-105b", name: "Sarvam 105B", contextLength: 131072 },
    { id: "sarvam-30b", name: "Sarvam 30B", contextLength: 65536 },
  ],
  serviceKinds: ["llm"],
};
