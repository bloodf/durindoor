export default {
  id: "monsterapi",
  alias: "monster",
  display: {
    name: "MonsterAPI",
    icon: "memory",
    color: "#7C3AED",
    textIcon: "MA",
    website: "https://www.monsterapi.ai",
    notice: { apiKeyUrl: "https://developer.monsterapi.ai" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.monsterapi.ai/v1/chat/completions",
  },
  models: [
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
  ],
};
