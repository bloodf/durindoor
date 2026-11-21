// Staged TwinMind port from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/twinmind/index.ts.
// Chat requires a provider-specific executor and Firebase ID-token lifecycle;
// registration batch must wire open-sse/executors/twinmind.js.
export default {
  id: "twinmind",
  alias: "tm",
  display: {
    name: "TwinMind",
    icon: "hub",
    color: "#2563EB",
    textIcon: "TM",
    website: "https://twinmind.com",
    notice: { apiKeyUrl: "https://twinmind.com", text: "Experimental app API; supply a Firebase access token. Tokens expire and require refresh." },
  },
  category: "apikey",
  authType: "apikey",
  transport: { baseUrl: "https://api2.twinmind.com/api/v3", format: "openai", executor: "twinmind", authType: "apikey" },
  models: [{ id: "auto", name: "Auto" }],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
