export default {
  id: "ainative",
  alias: "ainative",
  display: {
    name: "AINative Studio",
    icon: "route",
    color: "#7C3AED",
    textIcon: "AN",
    notice: {
      text: "OpenAI-compatible aggregator; the public catalog (84 models on 2026-07-20) is discovered live, the listed free-tier models are a fallback.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ainative.studio/api/v1/chat/completions",
    validateUrl: "https://api.ainative.studio/api/v1/models",
  },
  models: [
    { id: "qwen3-235b-cerebras", name: "Qwen3 235B (Cerebras)", contextLength: 131072 },
    { id: "qwen3-32b", name: "Qwen3 32B", contextLength: 131072 },
    { id: "qwen3-14b", name: "Qwen3 14B", contextLength: 131072 },
    { id: "qwen3-8b", name: "Qwen3 8B", contextLength: 131072 },
    { id: "llama-4-maverick", name: "Llama 4 Maverick", contextLength: 131072 },
    { id: "llama3.1-8b-cerebras", name: "Llama 3.1 8B (Cerebras)", contextLength: 131072 },
    { id: "deepseek-r1", name: "DeepSeek R1", contextLength: 65536 },
    { id: "nous-coder", name: "Nous Coder", contextLength: 131072 },
    { id: "gemini-flash", name: "Gemini Flash", contextLength: 131072 },
  ],
  modelsFetcher: { url: "https://api.ainative.studio/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
