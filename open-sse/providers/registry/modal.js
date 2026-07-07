export default {
  id: "modal",
  alias: "modal",
  hidden: true,
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
  // Modal inference is deployed per workspace/endpoint. Keep hidden until the
  // dashboard collects a user endpoint URL instead of using a global base URL.
  models: [],
};
