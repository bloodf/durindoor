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
    { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b" },
  ],
};
