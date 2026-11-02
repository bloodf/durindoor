// Magnific Mystic image generation (#1201). Ported from OmniRoute
// open-sse/config/providers/registry/magnific/index.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT). Magnific began as Freepik's
// developer API; `freepik` stays a legacy alias. Adapter:
// open-sse/handlers/imageProviders/magnific.js (async submit + poll).
export default {
  id: "magnific",
  alias: "magnific",
  aliases: ["freepik"],
  uiAlias: "magnific",
  display: {
    name: "Magnific",
    icon: "image",
    color: "#FF5A1F",
    textIcon: "MG",
    website: "https://magnific.com",
    notice: {
      text: "Image generation only (Mystic). Requests poll until the task completes (up to 2 minutes).",
      apiKeyUrl: "https://docs.magnific.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "realism", name: "Mystic Realism", params: ["size"], kind: "image" },
    { id: "fluid", name: "Mystic Fluid (Imagen 3)", params: ["size"], kind: "image" },
    { id: "zen", name: "Mystic Zen", params: ["size"], kind: "image" },
    { id: "flexible", name: "Mystic Flexible", params: ["size"], kind: "image" },
    { id: "super_real", name: "Mystic Super Real", params: ["size"], kind: "image" },
    { id: "editorial_portraits", name: "Mystic Editorial Portraits", params: ["size"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://api.magnific.com/v1/ai/mystic" },
};
