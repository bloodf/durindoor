// DemonRoute — OpenAI-compatible API-key gateway for hosted open-weight models.
//
// Upstream source: OmniRoute release/v3.8.55,
// open-sse/config/providers/registry/demonroute/index.ts at
// 4624250231f49ed118fb4522a9d735e4894322c6 (OmniRoute #16979).
// First-party contract: https://demonroute.com/docs
//
// The account-scoped /v1/models endpoint requires a Bearer key, so the seeds
// below are only an offline starting point; operators import the live catalog
// for their own account. Model channel IDs are exact, case-sensitive
// vendor/model strings, not display slugs. Prices and availability change, so
// none are hardcoded here. Embeddings are not declared: the seeded catalog is
// chat-only until an embedding model is verified.
export default {
  id: "demonroute",
  alias: "demonroute",
  display: {
    name: "DemonRoute",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "DR",
    website: "https://demonroute.com",
    notice: {
      text: "OpenAI-compatible gateway. Import the model catalog for your account.",
      apiKeyUrl: "https://demonroute.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.demonroute.com/v1/chat/completions",
    validateUrl: "https://api.demonroute.com/v1/models",
    format: "openai",
    // The provider recommends at least 120s; a slow reasoning model may send
    // its first streaming byte after the usual 60s connect ceiling.
    timeoutMs: 120_000,
  },
  serviceKinds: ["llm"],
  models: [
    { id: "dphn/Dolphin3.0-Llama3.1-8B", name: "Dolphin 3.0 Llama 3.1 8B" },
    { id: "dphn/Dolphin-Mistral-24B-Venice-Edition", name: "Dolphin Mistral 24B Venice" },
    { id: "TheDrummer/Artemis-31B-v1.2", name: "Artemis 31B v1.2" },
    { id: "TheDrummer/Cydonia-24B-v4.3", name: "Cydonia 24B v4.3" },
    { id: "huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated", name: "Huihui Qwen 3.6 35B A3B Abliterated" },
    { id: "huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2", name: "Huihui Gemma 4 31B Abliterated v2" },
    { id: "dphn/dolphin-2.9.3-mistral-nemo-12b", name: "Dolphin 2.9.3 Mistral Nemo 12B" },
  ],
  modelsFetcher: { url: "https://api.demonroute.com/v1/models", type: "openai" },
  passthroughModels: true,
};
