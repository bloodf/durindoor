export default {
  id: "inclusionai",
  priority: 70,
  alias: "inclusionai",
  display: {
    name: "InclusionAI",
    icon: "brain",
    color: "#2563EB",
    textIcon: "IA",
    website: "https://inclusionai.tech",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.inclusionai.tech/v1/chat/completions",
    validateUrl: "https://api.inclusionai.tech/v1/models",
    authHeader: "bearer",
  },
  models: [{ id: "inclusion-model", name: "Inclusion Model" }],
  serviceKinds: ["llm"],
};
