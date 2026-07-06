export default {
  id: "nanogpt",
  alias: "nanogpt",
  display: {
    name: "NanoGPT",
    icon: "api",
    color: "#22C55E",
    textIcon: "NG",
    website: "https://nano-gpt.com",
    notice: { apiKeyUrl: "https://nano-gpt.com/api" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://nano-gpt.com/api/v1/chat/completions",
  },
  models: [
    { id: "chatgpt-4o-latest", name: "chatgpt-4o-latest" },
    { id: "claude-3.5-sonnet", name: "claude-3.5-sonnet" },
    { id: "gpt-4o-mini", name: "gpt-4o-mini" },
  ],
};
