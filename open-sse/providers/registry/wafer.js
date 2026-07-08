export default {
  id: "wafer",
  alias: "wafer",
  display: {
    name: "Wafer AI",
    icon: "layers",
    color: "#6366F1",
    textIcon: "WF",
    website: "https://wafer.ai",
    notice: {
      text: "API key from wafer.ai.",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://pass.wafer.ai/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "Qwen3.5-397B-A17B", name: "Qwen3.5 397B A17B" },
    { id: "GLM-5.1", name: "GLM 5.1" },
  ],
};
