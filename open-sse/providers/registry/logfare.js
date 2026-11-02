export default {
  id: "logfare",
  alias: "logfare",
  display: {
    name: "Logfare",
    icon: "route",
    color: "#EA580C",
    textIcon: "LF",
    website: "https://logfare.ai",
    notice: {
      text: "Free inference. Logfare logs every request (prompts, completions, metadata) and may use scrubbed data for internal evaluation; opt out at https://logfare.ai/consent. The catalog also lists non-chat models such as whisper.",
      apiKeyUrl: "https://logfare.ai/register",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://logfare.ai/v1/chat/completions",
    validateUrl: "https://logfare.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://logfare.ai/v1/models", type: "openai", excludeIdPattern: "whisper|embed|tts|speech" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
