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
  // Seeded from the anonymous /v1/models response recorded in #768 (sarvam-30b is not served there).
  // Context lengths are omitted: /v1/models does not return them and the old values were unverified.
  // Unverified: authenticated /v1/models and chat routing (no live calls made); icon licence still open.
  models: [
    { id: "sarvam-105b", name: "Sarvam 105B" },
    { id: "sarvam-105b-conversations", name: "Sarvam 105B Conversations" },
  ],
  modelsFetcher: { url: "https://api.sarvam.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
