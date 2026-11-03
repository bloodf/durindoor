export default {
  id: "mlx",
  priority: 71,
  alias: "mlx",
  uiAlias: "mlx",
  display: {
    name: "MLX",
    icon: "memory",
    color: "#607D8B",
    textIcon: "MLX",
    website: "https://github.com/ml-explore/mlx-lm",
  },
  category: "apikey",
  authType: "apikey",
  noAuth: true,
  authHint: "No API key needed. Start `mlx_lm.server` (Apple silicon) and set its base URL (default: http://127.0.0.1:8080/v1).",
  thinkingFormat: "openai",
  transport: {
    baseUrl: "http://127.0.0.1:8080/v1",
    format: "openai",
  },
  // Passthrough only: models come from the server's /v1/models. Gemma and Qwen ids are
  // hints for the model field, not separate providers. Tool calling is not documented in
  // mlx-lm SERVER.md and is unverified here.
  models: [],
  passthroughModels: true,
};
