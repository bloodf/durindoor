// OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/g4f-ollama/index.ts.
export default {
  id: "g4f-ollama", alias: "g4foll", category: "apikey", authType: "apikey",
  display: { name: "g4f Ollama", icon: "memory", color: "#111827", textIcon: "G4F", website: "https://g4f.dev", notice: { apiKeyUrl: "https://g4f.dev/api_key.html", text: "Optional member key; anonymous requests may require g4f proof-of-work credits." } },
  transport: { baseUrl: "https://g4f.space/api/ollama/v1/chat/completions", validateUrl: "https://g4f.space/api/ollama/v1/models", modelsUrl: "https://g4f.space/api/ollama/v1/models", authHeader: "bearer" },
  models: [{ id: "gemma3:4b", name: "Gemma 3 4B (g4f/Ollama)" }],
  modelsFetcher: { url: "https://g4f.space/api/ollama/v1/models", type: "openai" }, passthroughModels: true, serviceKinds: ["llm"],
};
