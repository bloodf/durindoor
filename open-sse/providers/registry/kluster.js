export default {
  id: "kluster",
  priority: 70,
  alias: "kluster",
  display: {
    name: "Kluster AI",
    icon: "boxes",
    color: "#4F46E5",
    textIcon: "KL",
    website: "https://www.kluster.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.kluster.ai/v1/chat/completions",
    validateUrl: "https://api.kluster.ai/v1/models",
    authHeader: "bearer",
  },
  models: [{ id: "auto", name: "Auto" }],
  serviceKinds: ["llm"],
};
