export default {
  id: "chipotle",
  priority: 70,
  hasFree: true,
  alias: "pepper",
  uiAlias: "pepper",
  display: {
    name: "Chipotle Pepper",
    icon: "restaurant",
    color: "#ad2118",
    textIcon: "CP",
    website: "https://amelia.chipotle.com",
    notice: {
      text: "No-auth Amelia/Chipotle web chat provider. Availability depends on the public Chipotle Amelia session endpoint.",
    },
  },
  category: "free",
  noAuth: true,
  autoComboNoAuth: true,
  transport: {
    baseUrl: "https://amelia.chipotle.com",
    baseUrls: ["https://amelia.chipotle.com"],
    format: "openai",
    noAuth: true,
  },
  models: [{ id: "pepper-1", name: "Pepper (Chipotle AI)" }],
  passthroughModels: true,
};
