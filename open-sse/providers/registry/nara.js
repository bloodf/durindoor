export default {
  id: "nara",
  alias: "nara",
  display: {
    name: "NaraRouter",
    icon: "route",
    color: "#0F766E",
    textIcon: "NR",
    website: "https://router.bynara.id",
    notice: {
      text: "Free key issued after linking a Telegram account; the free plan is one 7M tokens/day bucket per account.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://router.bynara.id/v1/chat/completions",
    validateUrl: "https://router.bynara.id/v1/models",
  },
  models: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", contextLength: 262144, supportsVision: true },
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextLength: 524288, supportsVision: true },
    { id: "laguna-s-2.1", name: "Laguna S 2.1", contextLength: 262144 },
    { id: "minimax-m3-free", name: "MiniMax M3 (free)", contextLength: 1000000, supportsVision: true },
    { id: "mistral-large", name: "Mistral Large", contextLength: 252000 },
    { id: "mistral-medium-3-5", name: "Mistral Medium 3.5", contextLength: 256000, supportsVision: true },
    { id: "qwen3.8-27b", name: "Qwen3.8 27B" },
    { id: "stepfun-3.7-flash", name: "StepFun 3.7 Flash", contextLength: 262144 },
  ],
  serviceKinds: ["llm"],
};
