export default {
  id: "nanogpt",
  alias: "nanogpt",
  display: {
    name: "NanoGPT",
    icon: "chat",
    color: "#4F46E5",
    textIcon: "NG",
    website: "https://nano-gpt.com",
    notice: {
      apiKeyUrl: "https://nano-gpt.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://nano-gpt.com/api/v1/chat/completions",
    validateUrl: "https://nano-gpt.com/api/v1/models",
    format: "openai",
  },
  models: [
    { id: "chatgpt-4o-latest", name: "ChatGPT 4o Latest" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  ],
  serviceKinds: ["llm"],
};
