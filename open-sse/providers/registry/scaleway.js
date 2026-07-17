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
    { id: "llama-3.1-70b-instruct", name: "Llama 3.1 70B (EU)" },
    { id: "llama-3.1-8b-instruct", name: "Llama 3.1 8B (EU)" },
    { id: "mistral-small-3.2-24b-instruct-2506", name: "Mistral Small 3.2 (EU)" },
    { id: "deepseek-v3-0324", name: "DeepSeek V3 (EU)" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B (EU)" },
  ],
};
