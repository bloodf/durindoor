export default {
  id: "scaleway",
  alias: "scw",
  uiAlias: "scw",
  display: {
    name: "Scaleway AI",
    icon: "cloud",
    iconUrl: "/providers/scaleway.svg",
    color: "#4F0599",
    textIcon: "SCW",
    website: "https://www.scaleway.com/en/docs/ai-data/generative-apis/",
    notice: {
      text: "1M free tokens for new accounts; EU/GDPR compliant Paris region.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.scaleway.ai/v1/chat/completions",
  },
  models: [
    { id: "qwen3-235b-a22b-instruct-2507", name: "Qwen3 235B A22B (1M free tokens)" },
    { id: "mistral-small-3.2-24b-instruct-2506", name: "Mistral Small 3.2 (EU)" },
    { id: "deepseek-v3-0324", name: "DeepSeek V3 (EU)" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B (EU)" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash" },
    { id: "qwen3.8-27b", name: "Qwen 3.8 27B" },
    { id: "qwen3.6-35b-a3b", name: "Qwen 3.6 35B A3B" },
    { id: "qwen3.5-397b-a17b", name: "Qwen 3.5 397B A17B" },
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "mistral-medium-3.5-128b", name: "Mistral Medium 3.5 128B" },
  ],
};
