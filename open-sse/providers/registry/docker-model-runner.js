export default {
  id: "docker-model-runner",
  priority: 72,
  alias: "dmr",
  uiAlias: "dmr",
  display: {
    name: "Docker Model Runner",
    icon: "docker-model-runner.svg",
    color: "#2496ED",
    textIcon: "DM",
    website: "https://docs.docker.com/ai/model-runner/",
  },
  category: "apikey",
  authType: "apikey",
  authHint: "API key optional. Configure the local Docker Model Runner OpenAI-compatible base URL (default: http://localhost:12434/v1).",
  transport: {
    baseUrl: "http://localhost:12434/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
