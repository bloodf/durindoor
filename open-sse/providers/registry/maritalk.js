export default {
  id: "maritalk",
  priority: 70,
  alias: "maritalk",
  display: {
    name: "MariTalk",
    icon: "message-circle",
    color: "#16A34A",
    textIcon: "MT",
    website: "https://www.maritaca.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://chat.maritaca.ai/api/chat/completions",
    validateUrl: "https://chat.maritaca.ai/api/models",
    authHeader: "key",
    auth: { combined: true, header: "key", scheme: "raw" },
  },
  models: [
    { id: "sabia-4", name: "sabia-4" },
    { id: "sabia-3.1", name: "sabia-3.1" },
    { id: "sabiazinho-4", name: "sabiazinho-4" },
    { id: "sabiazinho-3", name: "sabiazinho-3" },
  ],
  serviceKinds: ["llm"],
};
