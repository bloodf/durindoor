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
  models: [
    { id: "gen2", name: "Gen 2 Video", kind: "video" },
    { id: "gen2-image", name: "Gen 2 Image", kind: "image" },
  ],
  // Hidden until image/video routes have Haiper adapters.
  serviceKinds: [],
  hiddenKinds: ["image", "video"],
};
