export default {
  id: "predibase",
  alias: "predibase",
  display: {
    name: "Predibase",
    icon: "storage",
    color: "#6366F1",
    textIcon: "PB",
    website: "https://predibase.com",
    notice: { apiKeyUrl: "https://serving.app.predibase.com" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://serving.app.predibase.com/v1/chat/completions",
  },
  models: [
    { id: "llama-3.3-70b", name: "llama-3.3-70b" },
  ],
};
