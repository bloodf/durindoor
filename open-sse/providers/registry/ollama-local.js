import { CLAUDE_API_HEADERS } from "../shared.js";

export const ollamaModels = {
  models: [
    {
      name: "llama3.2",
      modified_at: "2025-12-26T00:00:00Z",
      size: 2000000000,
      digest: "abc123def456",
      details: { format: "gguf", family: "llama", parameter_size: "3B", quantization_level: "Q4_K_M" }
    },
    {
      name: "qwen2.5",
      modified_at: "2025-12-26T00:00:00Z",
      size: 4000000000,
      digest: "def456abc123",
      details: { format: "gguf", family: "qwen", parameter_size: "7B", quantization_level: "Q4_K_M" }
    }
  ]
};

export default {
  id: "ollama-local",
  priority: 50,
  hasFree: true,
  alias: "ollama-local",
  display: {
    name: "Ollama Local",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
  },
  category: "apikey",
  // `/api/chat` consumes thinking intent through its top-level `think` field.
  thinkingFormat: "ollama",
  quirks: {
    preserveNativeClaudeThinking: true,
    normalizeNativeClaudeTransport: true,
    dropClaudeCacheControl: true,
    claudeImagesRequireBase64: true,
  },
  transport: {
    baseUrl: "http://localhost:11434",
    format: "ollama",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  // Host is resolved at request time by OllamaLocalExecutor.buildUrl via resolveOllamaLocalHost.
  transports: [
    {
      format: "claude",
      baseUrl: "http://localhost:11434/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      // COMP-04: Bearer to match cloud (ollama auth domain). Local ollama doesn't validate
      // keys, so this is a no-op when no key is set — but stays consistent with cloud.
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  serviceKinds: ["llm", "embedding"],
};
