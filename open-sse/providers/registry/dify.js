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
  models: [{ id: "configured-app", name: "Configured app" }],
  serviceKinds: ["llm"],
};
