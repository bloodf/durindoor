// Staged HyperAgent port from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/hyperagent/index.ts.
// This unofficial integration authenticates with a browser Cookie header and
// requires the provider-specific thread/SSE executor in the registration batch.
export default {
  id: "hyperagent",
  alias: "ha",
  display: {
    name: "HyperAgent",
    icon: "hub",
    color: "#0F766E",
    textIcon: "HA",
    website: "https://hyperagent.com",
    notice: { text: "Unofficial browser-session integration. Import a Cookie header; session access and credits are controlled by HyperAgent." },
  },
  category: "apikey",
  authType: "cookie",
  authHint: "Paste the Cookie header from an authenticated hyperagent.com session.",
  transport: { baseUrl: "https://hyperagent.com/api/threads", format: "openai", executor: "hyperagent", authType: "cookie" },
  models: [
    { id: "fable-latest", name: "Fable 5" },
    { id: "opus-latest", name: "Claude Opus Latest" },
    { id: "sonnet-latest", name: "Claude Sonnet Latest" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
