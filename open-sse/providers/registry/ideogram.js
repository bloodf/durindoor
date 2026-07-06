export default {
  id: "ideogram",
  priority: 70,
  alias: "ideo",
  display: {
    name: "Ideogram",
    icon: "image",
    color: "#111827",
    textIcon: "ID",
    website: "https://ideogram.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "V_3", name: "Ideogram V3", kind: "image" },
    { id: "V_2A", name: "Ideogram V2A", kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: {
    baseUrl: "https://api.ideogram.ai",
    authType: "apikey",
    authHeader: "Api-Key",
  },
};
