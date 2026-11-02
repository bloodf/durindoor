import { ANTHROPIC_API_VERSION } from "../shared.js";

export default {
  id: "helixmind",
  alias: "helixmind",
  display: {
    name: "HelixMind",
    icon: "route",
    color: "#8B5CF6",
    textIcon: "HM",
    notice: {
      text: "Reseller-style gateway with unverified upstreams. Also serves Anthropic Messages (/v1/messages, x-api-key) and OpenAI Responses (/v1/responses).",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://helixmind.online/v1/chat/completions",
    validateUrl: "https://helixmind.online/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://helixmind.online/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://helixmind.online/v1/messages",
      headers: { "Anthropic-Version": ANTHROPIC_API_VERSION },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://helixmind.online/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [],
  modelsFetcher: { url: "https://helixmind.online/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
