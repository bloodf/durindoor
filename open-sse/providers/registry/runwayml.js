export default {
  id: "runwayml",
  priority: 80,
  alias: "runwayml",
  aliases: [
    "runway",
  ],
  uiAlias: "runway",
  display: {
    name: "Runway ML",
    icon: "movie",
    color: "#000000",
    textIcon: "RW",
    website: "https://runwayml.com",
    notice: {
      apiKeyUrl: "https://dev.runwayml.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "gen4_image", name: "Gen-4 Image", params: ["size"], kind: "image" },
    { id: "gen4_image_turbo", name: "Gen-4 Image Turbo", params: ["size"], kind: "image" },
    { id: "gen4.5", name: "Gen-4.5", params: [], kind: "video" },
    { id: "gen4_turbo", name: "Gen-4 Turbo", params: [], kind: "video" },
    { id: "gen3a_turbo", name: "Gen-3 Alpha Turbo", params: [], kind: "video" },
    { id: "veo3.1", name: "Veo 3.1", params: [], kind: "video" },
    { id: "veo3.1_fast", name: "Veo 3.1 Fast", params: [], kind: "video" },
  ],
  // Video runs the native text/image-to-video task adapter in videoProviders
  // (no videoConfig: the /v1/videos job proxy has no accepted-job ledger).
  serviceKinds: ["image", "video"],
  imageConfig: { baseUrl: "https://api.dev.runwayml.com/v1" },
};
