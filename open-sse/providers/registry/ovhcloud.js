export default {
  id: "ovhcloud",
  alias: "ovh",
  display: {
    name: "OVHcloud",
    icon: "cloud",
    color: "#123F6D",
    textIcon: "OVH",
    website: "https://www.ovhcloud.com",
    notice: { apiKeyUrl: "https://endpoints.ai.cloud.ovh.net" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
  },
  models: [
    { id: "Meta-Llama-3_3-70B-Instruct", name: "Meta-Llama-3_3-70B-Instruct" },
    { id: "Qwen2.5-Coder-32B-Instruct", name: "Qwen2.5-Coder-32B-Instruct" },
    // Mistral Small 3.2 (24B) is a vision-language model — it accepts image
    // + text input, not text-only — so mark supportsVision here.
    { id: "Mistral-Small-3.2-24B-Instruct-2506", name: "Mistral-Small-3.2-24B-Instruct-2506", supportsVision: true },
  ],
};
