export default {
  id: "dify",
  alias: "dify",
  display: {
    name: "Dify",
    icon: "/providers/dify.svg",
    color: "#2563EB",
    textIcon: "DF",
    website: "https://dify.ai",
  },
  category: "apikey",
  authType: "apikey",
  // Hidden until connections can collect the per-application OpenAI-compatible endpoint.
  hidden: true,
  transport: {
    baseUrl: "https://api.dify.ai/v1/chat/completions",
    authHeader: "bearer",
  },
  models: [
    { id: "auto", name: "Auto" },
  ],
};
