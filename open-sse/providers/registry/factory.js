export default {
  id: "factory",
  alias: "factory",
  display: {
    name: "Factory",
    icon: "precision_manufacturing",
    color: "#475569",
    textIcon: "FA",
    website: "https://factory.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.factory.ai/v1/chat/completions",
    authHeader: "bearer",
  },
  // Factory's public docs describe baseUrl as an external model provider URL,
  // not a Factory-hosted /v1/chat/completions endpoint; hide until a correct
  // Factory LLM gateway route is implemented.
  hidden: true,
  // Factory's `auto` sentinel lets the upstream gateway choose the best model.
  models: [
    { id: "auto", name: "Factory Auto (best model)" },
  ],
};
