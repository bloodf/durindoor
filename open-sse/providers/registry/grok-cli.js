import xai from "./xai.js";

export default {
  id: "grok-cli",
  priority: 42,
  alias: "gc",
  display: {
    name: "Grok Build",
    icon: "terminal",
    color: "#111827",
    textIcon: "GC",
    website: "https://x.ai",
    notice: {
      signupUrl: "https://x.ai",
    },
  },
  category: "oauth",
  hasOAuth: true,
  transport: {
    baseUrl: "https://cli-chat-proxy.grok.com/v1/chat/completions",
    format: "openai",
    executor: "grok-cli",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    {
      id: "grok-build",
      name: "Grok Build",
      contextLength: 256000,
      unsupportedParams: ["presencePenalty", "frequencyPenalty", "logprobs", "topLogprobs"],
    },
    {
      id: "grok-composer-2.5-fast",
      name: "Grok Composer 2.5 Fast",
      contextLength: 200000,
      unsupportedParams: ["presencePenalty", "frequencyPenalty", "logprobs", "topLogprobs"],
    },
  ],
  passthroughModels: true,
  oauth: {
    clientId: xai.transport.clientId,
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refresh: { encoding: "form" },
    refreshLeadMs: 300000,
  },
};
