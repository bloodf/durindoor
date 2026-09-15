import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "deepseek",
  priority: 110,
  alias: "deepseek",
  aliases: [
    "ds",
  ],
  uiAlias: "ds",
  display: {
    name: "DeepSeek",
    icon: "bolt",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://deepseek.com",
    notice: {
      apiKeyUrl: "https://platform.deepseek.com/api_keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.deepseek.com/chat/completions",
    validateUrl: "https://api.deepseek.com/models",
    reasoningInject: {
      scope: "all",
    },
    quirks: {
      // DeepSeek's Anthropic-compatible endpoint accepts ONLY the built-in
      // web_search_* tools and rejects client-defined ones with HTTP 400
      //   "tools[0]: unknown variant `custom`, expected `web_search_20250305`
      //    or `web_search_20260209`".
      // The whitelist makes prepareClaudeRequest() forward web_search_* with
      // its `type` intact and drop other non-function tools instead of failing
      // the whole request. The OpenAI transport is unaffected: it targets
      // format "openai", so prepareClaudeRequest never runs for it.
      claudeSupportedToolTypes: ["web_search_20250305", "web_search_20260209"],
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.deepseek.com/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.deepseek.com/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportedFormats: ["openai", "claude"] },
    { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro Max", upstreamModelId: "deepseek-v4-pro", supportedFormats: ["openai", "claude"] },
    { id: "deepseek-v4-pro-none", name: "DeepSeek V4 Pro No Thinking", upstreamModelId: "deepseek-v4-pro", supportedFormats: ["openai", "claude"] },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportedFormats: ["openai", "claude"] },
    { id: "deepseek-chat", name: "DeepSeek V3.2 Chat", supportedFormats: ["openai", "claude"] },
    { id: "deepseek-reasoner", name: "DeepSeek V3.2 Reasoner", supportedFormats: ["openai", "claude"] },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};
