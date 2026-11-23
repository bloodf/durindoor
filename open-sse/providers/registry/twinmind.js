// Staged TwinMind port from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/twinmind/index.ts.
export default {
  id: "twinmind",
  // OmniRoute names this alias "tm", but tokenmarket already owns it in this registry.
  alias: "twinmind",
  display: {
    name: "TwinMind",
    icon: "hub",
    color: "#2563EB",
    textIcon: "TM",
    website: "https://twinmind.com",
    notice: { apiKeyUrl: "https://twinmind.com", text: "Experimental app API; supply a Firebase refresh token or a short-lived ID token." },
  },
  category: "apikey",
  authType: "apikey",
  transport: { baseUrl: "https://api2.twinmind.com/api/v3", format: "openai", executor: "twinmind", authType: "apikey" },
  models: [
    { id: "auto", name: "Auto" },
    { id: "gemini-3.1-pro-thinking", name: "Gemini 3.1 Pro Thinking" },
    { id: "gemini-3.8-flash-thinking", name: "Gemini 3.8 Flash Thinking" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    { id: "gpt-5.6-sol-thinking", name: "GPT-5.6 Sol Thinking" },
    { id: "gpt-5.5-thinking", name: "GPT-5.5 Thinking" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "claude-opus-5-thinking", name: "Claude Opus 5 Thinking" },
    { id: "claude-opus-4-7-thinking", name: "Claude Opus 4.7 Thinking" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
