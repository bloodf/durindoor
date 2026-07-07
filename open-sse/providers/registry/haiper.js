export default {
  id: "haiper",
  priority: 70,
  alias: "hp",
  display: {
    name: "Haiper",
    icon: "video",
    color: "#7C3AED",
    textIcon: "HP",
    website: "https://haiper.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.haiper.ai/v1",
    authHeader: "HAIPER_KEY",
    auth: { combined: true, header: "HAIPER_KEY", scheme: "raw" },
  },
  models: [],
  // Video/image generation only — never expose as LLM/chat models (PR #45 review).
  // Hidden until image/video routes have Haiper adapters.
  serviceKinds: [],
  hiddenKinds: ["image", "video"],
};
