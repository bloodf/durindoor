export default {
  id: "morph",
  alias: "morph",
  display: {
    name: "Morph",
    icon: "transform",
    color: "#14B8A6",
    textIcon: "MP",
    website: "https://www.morphllm.com",
    notice: { apiKeyUrl: "https://www.morphllm.com" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.morphllm.com/v1/chat/completions",
    // Morph fronts multiple upstream model families (Qwen/MiniMax/DeepSeek)
    // through one OpenAI-compatible endpoint, so force the OpenAI
    // reasoning_effort wire shape instead of a per-model native format.
    thinkingFormat: "openai",
  },
  models: [
    { id: "morph-v3-large", name: "morph-v3-large" },
    { id: "morph-v3-fast", name: "morph-v3-fast" },
    { id: "morph-qwen35-397b", name: "Qwen 3.5 397B (Morph)", contextLength: 262144 },
    { id: "morph-minimax27-230b", name: "MiniMax M2.7 (Morph)", contextLength: 200704 },
    { id: "morph-qwen36-27b", name: "Qwen 3.6 27B (Morph)", contextLength: 131072 },
    { id: "morph-dsv4flash", name: "DeepSeek V4 Flash (Morph)", contextLength: 1048576 },
  ],
};
