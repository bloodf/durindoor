// Contract: https://www.runcrate.ai/chat-api — one OpenAI-compatible chat
// completions endpoint, Bearer API keys, optional streaming, function calling
// and JSON mode.
//
// Ported from OmniRoute release/v3.8.55
// (4624250231f49ed118fb4522a9d735e4894322c6),
// open-sse/config/providers/registry/runcrate/index.ts and the matching
// CHAT_OPENAI_COMPAT_MODELS catalog entry in open-sse/config/providers/shared.ts.
// Only the documented model inference API is ported: instance creation, GPU
// provisioning and every other Runcrate surface stay out of this integration.
export default {
  id: "runcrate",
  alias: "runcrate",
  display: {
    name: "Runcrate",
    icon: "memory",
    color: "#111827",
    textIcon: "RC",
    website: "https://www.runcrate.ai",
    notice: {
      text: "One Runcrate API key covers every model on the OpenAI-compatible chat API. Model IDs keep their publisher prefix, for example runcrate/deepseek-ai/DeepSeek-V4.1-Flash.",
      apiKeyUrl: "https://www.runcrate.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.runcrate.ai/v1/chat/completions",
    validateUrl: "https://api.runcrate.ai/v1/models",
  },
  // Upstream catalog mapping (OmniRoute release/v3.8.55). The publisher prefix
  // is part of the model ID and must survive routing, so it is kept verbatim.
  models: [
    { id: "deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", name: "DeepSeek V4.1 Flash 1017" },
    { id: "zai-org/GLM-5.3", name: "GLM 5.3" },
    { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
    { id: "Qwen/Qwen3.8-Flash", name: "Qwen 3.8 Flash" },
    { id: "openai/gpt-oss-120b", name: "GPT OSS 120B" },
  ],
  // The live catalog changes faster than the seeded list above.
  modelsFetcher: { url: "https://api.runcrate.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
