// Pioneer is now Fastino (api.pioneer.ai is retired; host is api.fastino.ai).
// Sources: https://docs.fastino.ai/llms-full.txt (authentication, model catalog, pricing).
// Only decoder models documented for inference are listed. GLiNER/GLiDE models need a
// request `schema` or /v1/systemone and do not fit the chat surface, so they are omitted.
// Unverified: no live call was made. Whether /v1/chat/completions serves the decoder IDs
// below without a `schema`, and the authenticated /v1/models contents, are unconfirmed.
export default {
  id: "pioneer",
  alias: "pioneer",
  display: {
    name: "Pioneer (Fastino)",
    icon: "rocket_launch",
    color: "#0EA5E9",
    textIcon: "PI",
    website: "https://docs.fastino.ai",
    notice: {
      text: "Fastino inference API (formerly Pioneer). Keys start with fast_sk_; legacy pio_sk_ keys are retired.",
      apiKeyUrl: "https://agent.fastino.ai/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.fastino.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4", name: "Nemotron 3.5 Super VL", contextLength: 262144 },
    { id: "fastino/Fastino-Nemotron-3.5-Lightning-Finance", name: "Fastino Nemotron 3.5 Lightning Finance", contextLength: 8192 },
    { id: "fastino/Fastino-Nemotron-3.5-Lightning-Healthcare", name: "Fastino Nemotron 3.5 Lightning Healthcare", contextLength: 8192 },
  ],
  serviceKinds: ["llm"],
};
