// OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/g4f-gemini/index.ts. g4f.space documents
// anonymous access; an optional member key is forwarded when supplied.
export default {
  id: "g4f-gemini", alias: "g4fgem", category: "apikey", authType: "apikey",
  display: { name: "g4f Gemini", icon: "hub", color: "#4285F4", textIcon: "G4F", website: "https://g4f.dev", notice: { apiKeyUrl: "https://g4f.dev/api_key.html", text: "Optional member key; anonymous requests may require g4f proof-of-work credits." } },
  transport: { baseUrl: "https://g4f.space/api/gemini/v1/chat/completions", validateUrl: "https://g4f.space/api/gemini/v1/models", modelsUrl: "https://g4f.space/api/gemini/v1/models", authHeader: "bearer" },
  models: [{ id: "models/gemini-2.5-flash", name: "Gemini 2.5 Flash (g4f)" }, { id: "models/gemini-2.5-pro", name: "Gemini 2.5 Pro (g4f)" }],
  modelsFetcher: { url: "https://g4f.space/api/gemini/v1/models", type: "openai" }, passthroughModels: true, serviceKinds: ["llm"],
};
