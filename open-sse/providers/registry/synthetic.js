export default {
  id: "synthetic",
  alias: "synthetic",
  aliases: [
    "syn",
    "synthetic-new",
  ],
  uiAlias: "syn",
  display: {
    name: "Synthetic",
    icon: "verified_user",
    iconUrl: "/providers/synthetic.svg",
    color: "#111827",
    textIcon: "SY",
    website: "https://synthetic.new",
    notice: {
      apiKeyUrl: "https://synthetic.new/user-settings/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  transport: {
    baseUrl: "https://api.synthetic.new/openai/v1/chat/completions",
    // /openai/v1/models is public, so it cannot tell a bad key from a good one; quotas can.
    validateUrl: "https://api.synthetic.new/v2/quotas",
    usage: {
      url: "https://api.synthetic.new/v2/quotas",
    },
  },
  models: [
    { id: "hf:zai-org/GLM-5.3", name: "GLM 5.3" },
    { id: "hf:zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
    { id: "hf:zai-org/GLM-4.7-Flash", name: "GLM 4.7 Flash" },
    { id: "hf:moonshotai/Kimi-K3", name: "Kimi K3" },
    { id: "hf:deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash" },
    { id: "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017", name: "DeepSeek V4.1 Flash 1017" },
    { id: "hf:Qwen/Qwen3.8-27B", name: "Qwen3.8 27B" },
    { id: "hf:openai/gpt-oss-120b", name: "GPT-OSS 120B" },
    { id: "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4", name: "Nemotron 3 Super 120B" },
    { id: "hf:nvidia/Kimi-K2.5-NVFP4", name: "Kimi K2.5 (NVFP4)" },
    { id: "hf:MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "hf:moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "hf:deepseek-ai/DeepSeek-V3.2", name: "DeepSeek V3.2" },
  ],
  modelsFetcher: { url: "https://api.synthetic.new/openai/v1/models", type: "openai" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
