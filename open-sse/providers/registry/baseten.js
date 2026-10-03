export default {
  id: "baseten",
  alias: "baseten",
  uiAlias: "baseten",
  display: {
    name: "Baseten",
    icon: "deployed_code",
    color: "#111827",
    textIcon: "BT",
    website: "https://baseten.co",
    notice: {
      text: "$30 free trial credits for GPU inference",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.baseten.co/v1/chat/completions",
    // Baseten is an OpenAI-compatible inference endpoint even for non-OpenAI
    // model families; keep reasoning in OpenAI shape.
    thinkingFormat: "openai",
  },
  models: [
    { id: "moonshotai/Kimi-K2.6", name: "moonshotai/Kimi-K2.6" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "deepseek-ai/DeepSeek-V4-Pro" },
    { id: "zai-org/GLM-5", name: "zai-org/GLM-5" },
    { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMaxAI/MiniMax-M2.5" },
    { id: "nvidia/Nemotron-120B-A12B", name: "nvidia/Nemotron-120B-A12B" },
    { id: "deepseek-ai/DeepSeek-V4-Pro-0813", name: "DeepSeek V4 Pro 0813" },
    { id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash" },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2" },
    { id: "zai-org/GLM-5.2-Fast", name: "GLM 5.2 Fast" },
    { id: "zai-org/GLM-5.3", name: "GLM 5.3" },
    { id: "zai-org/GLM-5.3-Fast", name: "GLM 5.3 Fast" },
    { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
    { id: "moonshotai/Kimi-K3", name: "Kimi K3" },
    { id: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B", name: "Nemotron Ultra" },
    { id: "openai/gpt-oss-120b", name: "OpenAI GPT 120B" },
  ],
};
