// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/helyxai/index.ts. API contract: https://helyx-ai.vercel.app/.
export default {
  id: "helyxai",
  alias: "helyxai",
  display: {
    name: "Helyx AI",
    icon: "hub",
    color: "#6D5DF6",
    textIcon: "HX",
    website: "https://helyxai.space",
    notice: {
      text: "OpenAI-compatible API. Helyx reports token usage and applies daily free tokens before paid balance.",
      apiKeyUrl: "https://helyxai.space/",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // Helyx's LiteSpeed host redirects this route to a trailing slash; using
    // the canonical path avoids a POST redirect that could drop the request body.
    baseUrl: "https://helyxai.space/v1/chat/completions/",
    validateUrl: "https://helyxai.space/v1/models",
  },
  serviceKinds: ["llm"],
  models: [
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "anthropic/claude-opus-4", name: "Claude Opus 4" },
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek R1" },
    { id: "mistral/mistral-large", name: "Mistral Large" },
    { id: "alibaba/qwen3-235b-a22b", name: "Qwen3 235B" },
  ],
  modelsFetcher: { url: "https://helyxai.space/v1/models", type: "openai" },
  passthroughModels: true,
};
