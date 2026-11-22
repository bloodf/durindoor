export default {
  id: "paraloncloud",
  priority: 165,
  alias: "paraloncloud",
  aliases: [
    "paralon",
  ],
  uiAlias: "paralon",
  display: {
    name: "ParalonCloud",
    icon: "cloud",
    color: "#2EE6A6",
    textIcon: "PC",
    website: "https://paraloncloud.com",
    notice: {
      apiKeyUrl: "https://paraloncloud.com/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  authHint: "Create an API key (prlc_…) in the ParalonCloud console, then paste it here.",
  transport: {
    baseUrl: "https://paraloncloud.com/v1/chat/completions",
    responsesBaseUrl: "https://paraloncloud.com/v1/responses",
    validateUrl: "https://paraloncloud.com/v1/models",
  },
  // Live catalog follows whichever GPUs are online, so chat and native Responses
  // both accept ids outside this offline seed.
  transports: [
    { format: "openai", baseUrl: "https://paraloncloud.com/v1/chat/completions" },
    { format: "openai-responses", baseUrl: "https://paraloncloud.com/v1/responses" },
  ],
  passthroughModels: true,
  models: [
    { id: "qwen3.8-27b", name: "Qwen3.8 27B", contextLength: 131072 },
    { id: "qwen3-3b", name: "Qwen3 4B", contextLength: 32768 },
    { id: "multilingual-e5-small", name: "Multilingual E5 Small", kind: "embedding" },
  ],
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "https://paraloncloud.com/v1/embeddings" },
};
