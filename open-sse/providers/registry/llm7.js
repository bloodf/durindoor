export default {
  id: "llm7",
  priority: 70,
  alias: "llm7",
  display: {
    name: "LLM7",
    icon: "route",
    color: "#DB2777",
    textIcon: "L7",
    website: "https://llm7.io",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.llm7.io/v1/chat/completions",
    validateUrl: "https://api.llm7.io/v1/models",
    authHeader: "bearer",
  },
  models: [
    { id: "gpt-4o-mini-2024-07-18", name: "GPT-4o mini (LLM7)" },
    { id: "gpt-4.1-nano-2025-04-14", name: "GPT-4.1 nano (LLM7)" },
    { id: "deepseek-r1-0528", name: "DeepSeek R1 (LLM7)" },
    { id: "qwen2.5-coder-32b-instruct", name: "Qwen2.5 Coder 32B (LLM7)" },
  ],
  serviceKinds: ["llm"],
  modelsFetcher: { url: "https://api.llm7.io/v1/models", type: "openai" },
};
