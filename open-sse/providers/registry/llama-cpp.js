export default {
  id: "llama-cpp",
  priority: 70,
  alias: "llamacpp",
  uiAlias: "llamacpp",
  display: {
    name: "llama.cpp",
    icon: "memory",
    color: "#795548",
    textIcon: "LC",
    website: "https://github.com/ggml-org/llama.cpp",
  },
  category: "apikey",
  authType: "apikey",
  authHint: "API key optional. Configure the llama-server OpenAI-compatible base URL (default: http://127.0.0.1:8080/v1).",
  transport: {
    baseUrl: "http://127.0.0.1:8080/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
