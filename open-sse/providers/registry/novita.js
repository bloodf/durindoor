export default {
  id: "novita",
  alias: "novita",
  display: {
    name: "Novita AI",
    icon: "auto_awesome",
    color: "#F43F5E",
    textIcon: "NV",
    website: "https://novita.ai",
    notice: { apiKeyUrl: "https://novita.ai/settings/key-management" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.novita.ai/openai/v1/chat/completions",
    validateUrl: "https://api.novita.ai/openai/v1/models",
  },
  models: [
    { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
  ],
  modelsFetcher: { url: "https://api.novita.ai/openai/v1/models", type: "openai" },
};
