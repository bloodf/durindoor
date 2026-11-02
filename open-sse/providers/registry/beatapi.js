export default {
  id: "beatapi",
  alias: "beatapi",
  display: {
    name: "BeatAPI",
    icon: "route",
    color: "#E11D48",
    textIcon: "BA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.beatapi.io/v1/chat/completions",
    validateUrl: "https://api.beatapi.io/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.beatapi.io/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.beatapi.io/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [],
  modelsFetcher: { url: "https://api.beatapi.io/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
