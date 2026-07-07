export default {
  id: "reka",
  alias: "reka",
  display: {
    name: "Reka",
    icon: "auto_awesome",
    color: "#111827",
    textIcon: "RK",
    website: "https://docs.reka.ai/chat/overview",
    notice: {
      text: "Reka Chat is OpenAI-compatible on /v1. DurinDoor sends both Authorization and X-Api-Key headers for compatibility.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.reka.ai/v1/chat/completions",
    validateUrl: "https://api.reka.ai/v1/models",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      extraHeaders: [{ header: "X-Api-Key", from: "apiKey" }],
    },
    headers: {},
  },
  models: [
    { id: "reka-flash-3", name: "Reka Flash 3" },
    { id: "reka-flash", name: "Reka Flash" },
    { id: "reka-edge-2603", name: "Reka Edge 2603" },
  ],
};
