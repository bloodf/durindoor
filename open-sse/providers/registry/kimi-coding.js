import { CLAUDE_API_HEADERS, KIMI_CODING_BASE_URL, KIMI_CODING_OPENAI_URL, KIMI_CODING_RESPONSES_URL } from "../shared.js";

/** Native wire formats; "openai" is left out so Chat routing is unchanged. */
const KIMI_CODE_FORMATS = ["claude", "openai-responses"];

export default {
  id: "kimi-coding",
  hidden: true,
  priority: 120,
  alias: "kmc",
  display: {
    name: "Kimi Coding",
    icon: "psychology",
    color: "#1E40AF",
    textIcon: "KC",
    website: "https://www.kimi.com",
    notice: {
      signupUrl: "https://www.kimi.com",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: KIMI_CODING_BASE_URL,
    format: "claude",
    /** decolua/9router#3421: Kimi Code requires SSE upstream; chatCore buffers JSON clients. */
    forceStream: true,
    headers: { ...CLAUDE_API_HEADERS },
    reasoningInject: {
      scope: "all",
    },
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token",
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
      hooks: [
        "kimiHeaders",
      ],
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: KIMI_CODING_OPENAI_URL,
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["kimiHeaders"] },
    },
    {
      format: "claude",
      baseUrl: KIMI_CODING_BASE_URL,
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw", hooks: ["kimiHeaders"] },
    },
    // Responses clients (Codex) go straight to the native endpoint; Chat and Claude
    // clients keep their current transport (models list supportedFormats below).
    {
      format: "openai-responses",
      baseUrl: KIMI_CODING_RESPONSES_URL,
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["kimiHeaders"] },
    },
  ],
  models: [
    /** `k3[1m]` is documented only as a Claude Code inbound spelling; emit canonical `k3`. */
    { id: "k3", name: "Kimi K3", supportedFormats: KIMI_CODE_FORMATS, aliases: ["k3[1m]"] },
    { id: "k3-256k", name: "Kimi K3 256K", supportedFormats: KIMI_CODE_FORMATS },
    { id: "kimi-for-coding", name: "Kimi K2.8 Preview", supportedFormats: KIMI_CODE_FORMATS },
    { id: "kimi-for-coding-highspeed", name: "Kimi K2.7 Code HighSpeed", supportedFormats: KIMI_CODE_FORMATS },
  ],
  oauth: {
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshLeadMs: 300000,
  },
  features: {
    usage: true,
  },
};
