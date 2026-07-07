export default {
  id: "bytez",
  alias: "bytez",
  uiAlias: "bytez",
  display: {
    name: "Bytez",
    icon: "api",
    color: "#6366F1",
    textIcon: "BZ",
    website: "https://bytez.com",
    notice: {
      text: "$1 free credits, refreshes every 4 weeks",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.bytez.com/models/v2/openai/v1/chat/completions",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
    { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "mistralai/Mistral-7B-Instruct-v0.3" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen/Qwen2.5-72B-Instruct" },
  ],
};
