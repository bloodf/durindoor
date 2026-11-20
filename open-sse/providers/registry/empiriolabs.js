// OmniRoute open-sse/config/providers/registry/empiriolabs/index.ts, 4624250231f49ed118fb4522a9d735e4894322c6.
export default {
  id: "empiriolabs",
  alias: "empiriolabs",
  display: {
    name: "EmpirioLabs AI",
    icon: "hub",
    color: "#2563EB",
    textIcon: "EL",
    website: "https://empiriolabs.ai",
    notice: {
      text: "Connection validation requires an API key with account scope.",
      apiKeyUrl: "https://platform.empiriolabs.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.empiriolabs.ai/v1/chat/completions",
    validateUrl: "https://api.empiriolabs.ai/v1/account/usage?limit=1",
  },
  serviceKinds: ["llm"],
  models: [
    { id: "qwen3-8-flash", name: "Qwen3.8 Flash", contextLength: 1000000, supportsVision: true },
    { id: "qwen3-7-max", name: "Qwen3.7 Max", contextLength: 1000000 },
    { id: "glm-5-3", name: "GLM 5.3", contextLength: 1000000 },
    { id: "kimi-k2-7-code", name: "Kimi K2.7 Code", contextLength: 256000, supportsVision: true },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1000000 },
    { id: "deepseek-v4-1-flash", name: "DeepSeek V4.1 Flash", contextLength: 1000000, supportsVision: true },
    { id: "minimax-m3", name: "MiniMax M3", contextLength: 1000000, supportsVision: true },
  ],
  passthroughModels: true,
};
