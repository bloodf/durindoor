export default {
  id: "nscale",
  alias: "nscale",
  display: {
    name: "Nscale",
    icon: "speed",
    color: "#0EA5E9",
    textIcon: "NS",
    website: "https://www.nscale.com",
    notice: { apiKeyUrl: "https://platform.nscale.com" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.api.nscale.com/v1/chat/completions",
  },
  models: [
    { id: "moonshotai/Kimi-K2.5", name: "moonshotai/Kimi-K2.5" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen/Qwen3-235B-A22B-Instruct-2507" },
    { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b" },
    { id: "openai/gpt-oss-20b", name: "openai/gpt-oss-20b" },
    { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct", name: "meta-llama/Llama-4-Scout-17B-16E-Instruct" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
  ],
};
