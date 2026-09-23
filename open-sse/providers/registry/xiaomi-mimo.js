import { CLAUDE_API_HEADERS } from "../shared.js";

// Dual auth:
//   - API key (sk-...)      -> cloud API on api.xiaomimimo.com
//   - Xiaomi account session -> the v2.6 models also run on the account-service
//     route (mimo-server-<region>.xiaomimimo.com), billed to the account's weekly
//     Desktop quota and authorized by a session cookie instead of the key.
// The route is picked per request in executors/xiaomi-mimo.js; see
// docs/providers/connecting-accounts.mdx (Xiaomi MiMo) for the login flow.
export default {
  id: "xiaomi-mimo",
  priority: 290,
  alias: "xiaomi-mimo",
  aliases: [
    "mimo",
    "mimo-desktop",
    "xmd",
  ],
  uiAlias: "mimo",
  display: {
    name: "Xiaomi MiMo",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "XM",
    website: "https://xiaomimimo.com",
    notice: {
      apiKeyUrl: "https://platform.xiaomimimo.com/console/api-keys",
      signupUrl: "https://mimo.xiaomimimo.com/desktop/invite/",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  // Xiaomi account clusters (MiMo Desktop's five regions). Only the account
  // route uses this: host mimo-server-<id>, SSO sid mimo<id> (cn is mimopc).
  regions: [
    { id: "cn", label: "China (中国大陆)" },
    { id: "sgp", label: "Singapore (新加坡)" },
    { id: "ams", label: "Europe · Amsterdam (欧洲)" },
    { id: "ru", label: "Russia (俄罗斯)" },
    { id: "in", label: "India (印度)" },
  ],
  defaultRegion: "sgp",
  transport: {
    baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    validateUrl: "https://api.xiaomimimo.com/v1/models",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.xiaomimimo.com/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    // Dual-route: account-service route when the connection has a Xiaomi
    // session, cloud API otherwise. The account route only speaks OpenAI format.
    { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro", supportedFormats: ["openai"] },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash", supportedFormats: ["openai"] },
    { id: "mimo-v2.6-pro-ultraspeed", name: "MiMo V2.6 Pro UltraSpeed", supportedFormats: ["openai"] },
    // Cloud API only (sk- key)
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
    { id: "mimo-v2-flash", name: "MiMo V2 Flash" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};
