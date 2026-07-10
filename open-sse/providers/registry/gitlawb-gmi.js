export default {
  id: "gitlawb-gmi",
  priority: 75,
  alias: "glb-gmi",
  display: {
    name: "Gitlawb GMI",
    icon: "cloud",
    color: "#FCA326",
    textIcon: "GMI",
    website: "https://opengateway.gitlawb.com",
  },
  category: "apikey",
  transport: {
    // OmniRoute stores the shared `/v1/gmi-cloud` prefix and appends the
    // operation path. DurinDoor executors consume a full endpoint instead.
    baseUrl: "https://opengateway.gitlawb.com/v1/gmi-cloud/chat/completions",
    modelsUrl: "https://opengateway.gitlawb.com/v1/gmi-cloud/models",
    /** Validate with a minimal chat POST when source auth semantics require a real model request, even when a separate models catalog exists. */
    probeUsesBaseUrl: true,
    headers: {
      "User-Agent": "OpenClaude/1.0 (linux; x86_64)",
      "X-Title": "OpenClaude CLI",
      "HTTP-Referer": "https://github.com/Gitlawb/openclaude",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Ported from OmniRoute gitlawb/gmi at source commit 3ddcee6.
  models: [
    { id: "XiaomiMiMo/MiMo-V2.5-Pro", name: "MiMo-V2.5-Pro (GMI)", contextLength: 1050000, maxOutputTokens: 131072 },
    { id: "XiaomiMiMo/MiMo-V2.5", name: "MiMo-V2.5 (GMI)", contextLength: 1050000, maxOutputTokens: 131072 },
  ],
  passthroughModels: true,
  modelsFetcher: {
    url: "https://opengateway.gitlawb.com/v1/gmi-cloud/models",
    type: "openai",
  },
};
