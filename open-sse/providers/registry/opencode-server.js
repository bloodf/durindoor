export default {
  id: "opencode-server",
  alias: "ocs",
  display: {
    name: "OpenCode Server",
    icon: "server",
    color: "#414141",
    textIcon: "OC",
    website: "https://opencode.ai/docs/api",
  },
  category: "apikey",
  authType: "apikey",
  authHint: "Enter the server URL and its HTTP Basic credential as username:password.",
  transport: {
    format: "openai",
    forceNonStreaming: true,
  },
  models: [],
  passthroughModels: true,
};
