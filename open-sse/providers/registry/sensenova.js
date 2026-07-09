export default {
  id: "sensenova",
  alias: "sensenova",
  display: {
    name: "SenseNova",
    icon: "auto_awesome",
    iconUrl: "/providers/sensenova.svg",
    color: "#0066FF",
    textIcon: "SN",
    website: "https://platform.sensenova.cn",
    notice: {
      text: "SenseNova registration appears to require a Chinese (+86) phone number for SMS verification; international users may be unable to obtain an API key.",
      signupUrl: "https://platform.sensenova.cn/console",
    },
  },
  category: "freeTier",
  transport: {
    // SenseNova Token Plan (validated 2026-07-06): OpenAI-compatible endpoint
    // that enforces max_tokens in [1, 65536]. Do not raise above 65536.
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    requestDefaults: {
      maxTokens: 65536,
    },
  },
  models: [
    // SenseNova Token Plan chat models (validated 2026-07-06). The /models
    // list also advertises sensenova-u1-fast, but chat completions 404 for it;
    // U1 Fast belongs to image flows, so omit it here.
    {
      id: "sensenova-6.7-flash-lite",
      name: "SenseNova 6.7 Flash-Lite",
      contextLength: 262144,
      maxOutputTokens: 65536,
      supportsVision: true,
      toolCalling: true,
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      contextLength: 1048576,
      maxOutputTokens: 65536,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    },
    {
      id: "glm-5.2",
      name: "GLM 5.2",
      contextLength: 1048576,
      maxOutputTokens: 65536,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    },
  ],
  passthroughModels: true,
};
