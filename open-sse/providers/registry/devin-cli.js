export default {
  id: "devin-cli",
  priority: 100,
  display: {
    name: "Devin CLI",
    icon: "code",
    color: "#111827",
    textIcon: "DV",
    website: "https://cli.devin.ai",
  },
  category: "oauth",
  transport: {
    baseUrl: "devin://acp/stdio",
    format: "openai",
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
