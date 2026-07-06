export default {
  id: "nous-research",
  alias: "nous",
  display: {
    name: "Nous Research",
    icon: "psychology",
    color: "#8B5CF6",
    textIcon: "NO",
    website: "https://nousresearch.com",
    notice: { apiKeyUrl: "https://inference-api.nousresearch.com" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
  },
  models: [
    { id: "Hermes-4-405B", name: "Hermes 4 7B (Nous Research)" },
    { id: "Hermes-4-70B", name: "Hermes 4 70B (Nous Research)" },
  ],
};
