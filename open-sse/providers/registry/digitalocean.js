import { ANTHROPIC_API_VERSION } from "../shared.js";

export default {
  id: "digitalocean",
  priority: 80,
  alias: "digitalocean",
  aliases: [
    "do",
  ],
  uiAlias: "do",
  display: {
    name: "DigitalOcean",
    icon: "cloud",
    color: "#0060FF",
    textIcon: "DO",
    website: "https://docs.digitalocean.com/products/ai-platform/",
    notice: {
      text: "Use a DigitalOcean Personal Access Token (dop_v1_...) or a Model Access Key from the Inference console. OAuth tokens (doo_v1_...) may not have the required scopes.",
      apiKeyUrl: "https://cloud.digitalocean.com/account/api/tokens",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://inference.do-ai.run/v1/chat/completions",
    validateUrl: "https://inference.do-ai.run/v1/models",
    thinkingFormat: "openai",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://inference.do-ai.run/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://inference.do-ai.run/v1/messages",
      headers: { "Anthropic-Version": ANTHROPIC_API_VERSION },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://inference.do-ai.run/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "anthropic-claude-fable-5", name: "Claude Fable 5" },
    { id: "anthropic-claude-5-sonnet", name: "Claude Sonnet 5" },
    { id: "anthropic-claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "anthropic-claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "anthropic-claude-4.6-sonnet", name: "Claude Sonnet 4.6" },
    { id: "anthropic-claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "openai-gpt-5.5", name: "GPT 5.5", targetFormat: "openai-responses" },
    { id: "openai-gpt-5.4", name: "GPT 5.4", targetFormat: "openai-responses" },
    { id: "openai-gpt-5.4-mini", name: "GPT 5.4 Mini", targetFormat: "openai-responses" },
    { id: "openai-gpt-oss-120b", name: "GPT OSS 120B" },
    { id: "openai-gpt-oss-20b", name: "GPT OSS 20B" },
    { id: "llama3.3-70b-instruct", name: "Llama 3.3 70B Instruct" },
  ],
  serviceKinds: ["llm"],
  modelsFetcher: { url: "https://inference.do-ai.run/v1/models", type: "openai" },
  passthroughModels: true,
};
