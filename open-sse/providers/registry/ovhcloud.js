export default {
  id: "ovhcloud",
  alias: "ovh",
  display: {
    name: "OVHcloud AI",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "OVH",
    website: "https://www.ovhcloud.com",
    notice: {
      apiKeyUrl: "https://www.ovhcloud.com",
    },
  },
  category: "apikey",
  // Anonymous tier answers with no key (2 req/min/IP); a key raises the limit
  // to 400 req/min. A bad key gets 403 instead of falling back to anonymous.
  authType: "optional",
  transport: {
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    validateUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models",
    format: "openai",
  },
  models: [
    { id: "Meta-Llama-3_3-70B-Instruct", name: "Meta-Llama-3_3-70B-Instruct" },
    { id: "Qwen2.5-Coder-32B-Instruct", name: "Qwen2.5-Coder-32B-Instruct" },
    { id: "Mistral-Small-3.2-24B-Instruct-2506", name: "Mistral-Small-3.2-24B-Instruct-2506" },
  ],
  modelsFetcher: { url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models", type: "openai" },
  serviceKinds: ["llm"],
};
