export default {
  id: "subq",
  priority: 44,
  alias: "subq",
  aliases: ["subquadratic"],
  uiAlias: "subq",
  display: {
    name: "SubQ (Decisions API)",
    icon: "psychology",
    color: "#0834BC",
    textIcon: "SQ",
    website: "https://subq.ai",
    notice: {
      text: "SubQ Decisions API probabilistic decision engine. Fast calibrated evaluations over state and questions.",
      apiKeyUrl: "https://console.subq.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasProviderSpecificData: true,
  models: [
    { id: "subq-snap-preview", name: "SubQ Snap Preview", kind: "systemone" },
  ],
  serviceKinds: ["systemone"],
  systemoneConfig: {
    baseUrl: "https://api.subq.ai/v1/systemone",
    authType: "apikey",
    authHeader: "bearer",
  },
};
