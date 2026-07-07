export default {
  id: "llamafile",
  priority: 69,
  alias: "llamafile",
  display: {
    name: "Llamafile",
    icon: "llamafile.png",
    color: "#EA580C",
    textIcon: "LF",
    website: "https://github.com/Mozilla-Ocho/llamafile",
  },
  category: "apikey",
  authType: "apikey",
  authHint: "API key optional. Configure the local Llamafile OpenAI-compatible base URL (default: http://127.0.0.1:8080/v1).",
  transport: {
    baseUrl: "http://127.0.0.1:8080/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
