// OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/g4f-nvidia/index.ts.
export default {
  id: "g4f-nvidia", alias: "g4fnv", category: "apikey", authType: "apikey",
  display: { name: "g4f NVIDIA", icon: "developer_board", color: "#76B900", textIcon: "G4F", website: "https://g4f.dev", notice: { apiKeyUrl: "https://g4f.dev/api_key.html", text: "Optional member key; anonymous requests may require g4f proof-of-work credits." } },
  transport: { baseUrl: "https://g4f.space/api/nvidia/v1/chat/completions", validateUrl: "https://g4f.space/api/nvidia/v1/models", modelsUrl: "https://g4f.space/api/nvidia/v1/models", authHeader: "bearer" },
  models: [{ id: "nvidia/nemotron-3-nano-30b-a3b", name: "Nemotron 3 Nano 30B (g4f/NVIDIA)" }, { id: "z-ai/glm-5.2", name: "GLM 5.2 (g4f/NVIDIA)" }, { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7 (g4f/NVIDIA)" }],
  modelsFetcher: { url: "https://g4f.space/api/nvidia/v1/models", type: "openai" }, passthroughModels: true, serviceKinds: ["llm"],
};
