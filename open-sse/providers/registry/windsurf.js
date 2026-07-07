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
    chatPath: "/exa.language_server_pb.LanguageServerService/GetChatMessage",
    format: "openai",
    // Windsurf speaks gRPC-web on the wire but converts responses to OpenAI chat
    // JSON/SSE before returning them, so response handling sees "openai".
    defaultContextLength: 200000,
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  oauth: {
    flowType: "import_token",
  },
};
