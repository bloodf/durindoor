export default {
  id: "leonardo",
  priority: 70,
  alias: "leo",
  display: {
    name: "Leonardo.Ai",
    icon: "image",
    color: "#7C2D12",
    textIcon: "LE",
    website: "https://leonardo.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "phoenix", name: "Phoenix", kind: "image" },
    { id: "sdxl", name: "SDXL", kind: "image" },
  ],
  // Hidden until an image adapter is registered in handlers/imageProviders.
  serviceKinds: [],
  hiddenKinds: ["image"],
  imageConfig: {
    baseUrl: "https://cloud.leonardo.ai/api/rest/v1",
    authType: "apikey",
    authHeader: "bearer",
  },
};
