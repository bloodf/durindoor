export default {
  id: "windsurf",
  priority: 100,
  display: {
    name: "Windsurf",
    icon: "code",
    color: "#00A3FF",
    textIcon: "WS",
    website: "https://windsurf.com",
  },
  category: "oauth",
  transport: {
    baseUrl: "https://server.self-serve.windsurf.com",
    format: "openai",
    defaultContextLength: 200000,
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    blockedReason: "Requires verified Windsurf gRPC-web protobuf transport.",
  },
  oauth: {
    flowType: "import_token",
  },
};
