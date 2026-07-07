export default {
  id: "vllm",
  priority: 67,
  alias: "vllm",
  display: {
    name: "vLLM",
    icon: "memory",
    color: "#0F766E",
    textIcon: "VL",
    website: "https://github.com/vllm-project/vllm",
  },
  category: "apikey",
  authType: "apikey",
  noAuth: true,
  authHint: "API key optional. Configure the local vLLM OpenAI-compatible base URL (default: http://localhost:8000/v1).",
  thinkingFormat: "openai",
  transport: {
    baseUrl: "http://localhost:8000/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
