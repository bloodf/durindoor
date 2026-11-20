// Identity adapted from OmniRoute's devin-cli-agentic registry. The catalog
// exposes only selections documented by Cognition for the local CLI.
export default {
  id: "devin-cli-agentic",
  priority: 100,
  alias: "dva",
  uiAlias: "dva",
  category: "free",
  authType: "none",
  noAuth: true,
  display: {
    name: "Devin CLI (Agentic)",
    icon: "terminal",
    color: "#111827",
    textIcon: "DA",
    website: "https://docs.devin.ai/cli",
    notice: {
      text: "Experimental. Uses an isolated, signed-in Devin CLI on the server. Add a connection without an API key. Devin account charges may apply.",
    },
  },
  transport: {
    baseUrl: "devin://acp/stdio",
    format: "claude",
    noAuth: true,
  },
  models: [
    { id: "adaptive", name: "Devin Adaptive" },
    { id: "swe-1-6-fast", name: "Devin SWE-1.6 Fast" },
  ],
};
