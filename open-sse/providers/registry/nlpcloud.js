// Catalog and wire contract: https://docs.nlpcloud.com/#chatbot-and-conversational-ai
// Adapted from OmniRoute open-sse/config/providers/registry/nlpcloud/index.ts
// at 2c4aa9e9af21e2ad27440c4c478c10282154a596 (MIT).
export default {
  id: "nlpcloud",
  alias: "nlpc",
  display: {
    name: "NLP Cloud",
    icon: "bolt",
    textIcon: "NC",
    color: "#5C52D8",
    website: "https://nlpcloud.com",
    notice: { text: "Chatbot supports text conversations and native streaming. Tools, images and JSON mode are not supported." },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.nlpcloud.io/v1/gpu",
    format: "openai",
    auth: { header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "gpt-oss-120b", name: "GPT-OSS 120B", contextLength: 128000, toolCalling: false },
    { id: "llama-3-1-405b", name: "LLaMA 3.1 405B", contextLength: 128000, toolCalling: false },
    { id: "finetuned-llama-3-70b", name: "Fine-tuned LLaMA 3.3 70B", contextLength: 128000, toolCalling: false },
    { id: "chatdolphin", name: "ChatDolphin", contextLength: 8192, toolCalling: false },
    { id: "dolphin-yi-34b", name: "Dolphin Yi 34B", contextLength: 8192, toolCalling: false },
    { id: "dolphin-mixtral-8x7b", name: "Dolphin Mixtral 8x7B", contextLength: 8192, toolCalling: false },
  ],
};
