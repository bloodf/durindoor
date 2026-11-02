import { CLAUDE_API_HEADERS, KIMI_CODING_BASE_URL, KIMI_CODING_OPENAI_URL, KIMI_CODING_RESPONSES_URL } from "../shared.js";

/** Native wire formats; "openai" is left out so Chat routing is unchanged. */
const KIMI_CODE_FORMATS = ["claude", "openai-responses"];

export default {
  id: "kimi-coding-apikey",
  priority: 125,
  alias: "kmca",
  display: {
    name: "Kimi Coding API Key",
    icon: "psychology",
    color: "#1E40AF",
    textIcon: "KC",
    website: "https://www.kimi.com",
    notice: {
      apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: KIMI_CODING_BASE_URL,
    format: "claude",
    /** decolua/9router#3421: Kimi Code requires SSE upstream; chatCore buffers JSON clients. */
    forceStream: true,
    headers: { ...CLAUDE_API_HEADERS },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: KIMI_CODING_OPENAI_URL,
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: KIMI_CODING_BASE_URL,
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
    // Responses clients (Codex) go straight to the native endpoint; Chat and Claude
    // clients keep their current transport (models list supportedFormats below).
    {
      format: "openai-responses",
      baseUrl: KIMI_CODING_RESPONSES_URL,
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    /** K3 reaches 1M only for Allegretto+ accounts; lower tiers are server-gated to 256K. */
    { id: "k3", name: "Kimi K3", supportedFormats: KIMI_CODE_FORMATS, aliases: ["k3[1m]"], contextLength: 1048576, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
    { id: "k3-256k", name: "Kimi K3 256K", supportedFormats: KIMI_CODE_FORMATS, contextLength: 262144, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
    { id: "kimi-for-coding", name: "Kimi K2.8 Preview", supportedFormats: KIMI_CODE_FORMATS, contextLength: 1048576, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
    { id: "kimi-for-coding-highspeed", name: "Kimi K2.7 Code HighSpeed", supportedFormats: KIMI_CODE_FORMATS, contextLength: 262144, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
  ],
  defaultContextLength: 262144,
  features: {
    usage: true,
    usageApikey: true,
  },
};
