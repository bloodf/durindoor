export default {
  id: "modal",
  alias: "modal",
  display: {
    name: "Modal",
    icon: "deployed_code",
    color: "#4F46E5",
    textIcon: "MO",
    website: "https://modal.com",
    notice: { apiKeyUrl: "https://modal.com/settings/tokens" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.modal.ai/v1/chat/completions",
  },
  models: [
    { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
};
