export default {
  id: "nlpcloud",
  alias: "nlpc",
  display: {
    name: "NLP Cloud",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "NC",
    website: "https://nlpcloud.com",
    notice: { apiKeyUrl: "https://nlpcloud.com/home/playground/api-keys" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.nlpcloud.io/v1/chat/completions",
  },
  models: [
    { id: "chatdolphin", name: "ChatDolphin", contextLength: 8192 },
    { id: "dolphin", name: "Dolphin", contextLength: 16384 },
    { id: "finetuned-llama-3-70b", name: "Fine-tuned LLaMA 3.3 70B" },
    { id: "llama-3-1-405b", name: "LLaMA 3.1 405B" },
    { id: "llama-3-8b-instruct", name: "Llama 3 8B" },
  ],
};
