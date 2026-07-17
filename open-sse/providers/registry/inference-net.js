export default {
  id: "inference-net",
  priority: 70,
  alias: "inet",
  display: {
    name: "Inference.net",
    icon: "network",
    color: "#0891B2",
    textIcon: "IN",
    website: "https://inference.net",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.inference.net/v1/chat/completions",
    validateUrl: "https://api.inference.net/v1/models",
    authHeader: "bearer",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
    { id: "deepseek-ai/DeepSeek-R1", name: "deepseek-ai/DeepSeek-R1" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen/Qwen2.5-72B-Instruct" },
  ],
  serviceKinds: ["llm"],
};
