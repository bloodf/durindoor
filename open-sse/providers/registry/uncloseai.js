export default {
  id: "uncloseai",
  alias: "unc",
  uiAlias: "unc",
  display: {
    name: "UncloseAI",
    icon: "auto_awesome",
    color: "#8B5CF6",
    textIcon: "UN",
    website: "https://uncloseai.com",
    notice: {
      text: "Use an existing UncloseAI API key. The public beta and new key registration are closed.",
    },
  },
  // The keyless public beta closed (upstream 401, 2026-11-25; OmniRoute #21247).
  category: "apikey",
  transport: {
    baseUrl: "https://hermes.ai.unturf.com/v1/chat/completions",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic", name: "Hermes 3 Llama 3.1 8B" },
    { id: "qwen3.6:27b", name: "Qwen3 Coder 27B" },
    { id: "gemma4:31b", name: "Gemma 4 31B" },
  ],
  passthroughModels: true,
};
