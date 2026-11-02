export default {
  id: "dahl",
  alias: "dahl",
  display: {
    name: "Dahl",
    icon: "route",
    color: "#9333EA",
    textIcon: "DA",
    notice: {
      text: "Free inference. Mint a key with POST https://inference.dahl.global/tokens (response has a token field) and paste it here.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.dahl.global/v1/chat/completions",
    validateUrl: "https://inference.dahl.global/v1/models",
    defaultContextLength: 200000,
  },
  models: [
    { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
  ],
  serviceKinds: ["llm"],
};
