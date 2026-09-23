export default {
  id: "modal",
  alias: "mdl",
  display: {
    name: "Modal",
    icon: "cloud_queue",
    color: "#7C3AED",
    textIcon: "MDL",
    website: "https://modal.com/docs",
    notice: {
      text: "$30/month free credits for new accounts. Base URL should point to your OpenAI-compatible Modal app.",
      apiKeyUrl: "https://modal.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.modal.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
