export default {
  id: "glhf",
  alias: "glhf",
  display: {
    name: "GLHF",
    icon: "sports_esports",
    color: "#9333EA",
    textIcon: "GH",
    website: "https://glhf.chat",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.laf.run/v1/chat/completions",
    authHeader: "bearer",
  },
  models: [
    { id: "deepseek-7b-chat", name: "DeepSeek 7B Chat" },
  ],
};
