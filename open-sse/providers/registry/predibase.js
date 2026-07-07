export default {
  id: "predibase",
  alias: "predibase",
  hidden: true,
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
  // Predibase URLs are tenant/deployment scoped. Keep hidden until provider
  // setup collects the required deployment path segments.
  models: [],
};
