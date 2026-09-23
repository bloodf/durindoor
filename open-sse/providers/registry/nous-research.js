export default {
  id: "nous-research",
  alias: "nous",
  display: {
    name: "Nous Research",
    icon: "hub",
    color: "#2563EB",
    textIcon: "NO",
    website: "https://portal.nousresearch.com/help",
    notice: {
      text: "Free tier: 50 RPM, 500,000 TPM — no credit card.",
      apiKeyUrl: "https://portal.nousresearch.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "Hermes-4-405B", name: "Hermes 4 405B (Nous Research)" },
    { id: "Hermes-4-70B", name: "Hermes 4 70B (Nous Research)" },
  ],
  serviceKinds: ["llm"],
};
