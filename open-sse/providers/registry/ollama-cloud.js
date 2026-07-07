export default {
  id: "ollama-cloud",
  alias: "ollamacloud",
  display: {
    name: "Ollama Cloud",
    icon: "cloud_queue",
    color: "#111827",
    textIcon: "OC",
    website: "https://ollama.com",
    notice: { apiKeyUrl: "https://ollama.com/settings/keys" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://ollama.com/v1/chat/completions",
    // Ollama Cloud serves multiple upstream model families (DeepSeek/Kimi/
    // GLM/MiniMax/Qwen) through one OpenAI-compatible chat endpoint, so force
    // the OpenAI reasoning_effort wire shape rather than a per-model native
    // thinking format.
    thinkingFormat: "openai",
    // Dedicated key-check endpoint (api/tags), not /chat/completions with the
    // "/models" suffix swap the generic validator falls back to — register it
    // explicitly so provider key validation hits the right URL.
    validateUrl: "https://ollama.com/api/tags",
  },
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportsReasoning: true },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "minimax-m3", name: "MiniMax M3", contextLength: 1048576, supportsVision: true },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "gemma4:31b", name: "Gemma 4 31B" },
    { id: "nemotron-3-super", name: "NVIDIA Nemotron 3 Super" },
    { id: "qwen3.5:397b", name: "Qwen 3.5 397B" },
  ],
  modelsFetcher: { url: "https://ollama.com/api/tags", type: "ollama" },
  passthroughModels: true,
};
