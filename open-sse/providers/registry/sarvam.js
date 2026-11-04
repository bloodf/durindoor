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
      text: "₹100 in free credits for every verified user on signup; credits never expire.",
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
  // Sources (retrieved 2026-11-04): the chat completions reference at
  // https://docs.sarvam.ai/api-reference/chat/chat-completions-v1 says the endpoint "serves only
  // sarvam-105b and sarvam-105b-conversations", with 128K and 32K context. K is read as 1000, which
  // may understate the real window. Max output is undocumented, so none is declared. The docs accept
  // Bearer auth. sarvam-30b is not served. The anonymous /v1/models matches these two ids.
  // Unverified: authenticated /v1/models and chat routing (no live calls made); icon rights still open.
  models: [
    { id: "sarvam-105b", name: "Sarvam 105B", contextLength: 128000 },
    { id: "sarvam-105b-conversations", name: "Sarvam 105B Conversations", contextLength: 32000 },
  ],
  modelsFetcher: { url: "https://api.sarvam.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
