// DeepAI: media only. No chat endpoint; each model is its own REST route (POST /api/<model>).
// Only text2img is wired (synchronous). The async video routes (/video-api/*) are not ported.
// API access needs the user's own DeepAI Pro subscription.
// Unverified: no live call was made; behavior follows https://deepai.org/docs only.
export default {
  id: "deepai",
  alias: "deepai",
  display: {
    name: "DeepAI",
    icon: "image",
    color: "#EF4444",
    textIcon: "DA",
    website: "https://deepai.org/docs",
    notice: {
      text: "API access requires your own DeepAI Pro subscription.",
      apiKeyUrl: "https://deepai.org/dashboard",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "text2img", name: "Text to Image", params: ["size", "negative_prompt"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://api.deepai.org/api" },
};
