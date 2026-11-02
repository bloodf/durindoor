// 1min.ai Chat with AI (#1217). Ported from OmniRoute
// open-sse/config/providers/registry/oneminai/index.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT). Not OpenAI-compatible on the wire;
// open-sse/executors/oneminai.js translates requests and responses. The
// catalog is per-account on 1min.ai's dashboard, so only the model used in all
// of 1min.ai's docs examples is listed and passthroughModels allows other ids.
export default {
  id: "oneminai",
  alias: "1min",
  uiAlias: "1min",
  display: {
    name: "1min.ai",
    icon: "bolt",
    color: "#7C3AED",
    textIcon: "1M",
    website: "https://1min.ai",
    notice: {
      text: "Text-only: tool calling, JSON mode and image/file inputs are rejected. Multi-turn history is sent as one labeled transcript.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.1min.ai/api/chat-with-ai",
    auth: { header: "API-KEY", scheme: "raw" },
  },
  passthroughModels: true,
  models: [{ id: "gpt-4o-mini", name: "GPT-4o Mini", toolCalling: false }],
};
