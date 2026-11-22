// OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/g4f-pollinations/index.ts.
export default {
  id: "g4f-pollinations", alias: "g4fpol", category: "apikey", authType: "apikey",
  display: { name: "g4f Pollinations", icon: "hub", color: "#7C3AED", textIcon: "G4F", website: "https://g4f.dev", notice: { apiKeyUrl: "https://g4f.dev/api_key.html", text: "Optional member key; anonymous requests may require g4f proof-of-work credits." } },
  transport: { baseUrl: "https://g4f.space/api/pollinations/v1/chat/completions", validateUrl: "https://g4f.space/api/pollinations/v1/models", modelsUrl: "https://g4f.space/api/pollinations/v1/models", authHeader: "bearer" },
  models: [{ id: "openai", name: "OpenAI (g4f/Pollinations)" }, { id: "openai-fast", name: "OpenAI Fast (g4f/Pollinations)" }],
  modelsFetcher: { url: "https://g4f.space/api/pollinations/v1/models", type: "openai" }, passthroughModels: true, serviceKinds: ["llm"],
};
