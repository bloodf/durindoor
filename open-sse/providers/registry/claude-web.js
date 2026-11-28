// Claude.ai web session provider. Flow ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878), open-sse/executors/claude-web.ts.
export const claudeWebCookieProfile = Object.freeze({
  domains: ["claude.ai"],
  cookieNames: ["sessionKey"],
  validationProbe: { url: "https://claude.ai/api/organizations", method: "GET", okStatus: [200] },
});

export default {
  id: "claude-web",
  priority: 247,
  alias: "cw",
  display: { name: "Claude Web", icon: "claude", color: "#D97757", textIcon: "CW", website: "https://claude.ai" },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the sessionKey cookie or a Cookie header from claude.ai.",
  // Import and capture keep `sessionKey` required and also keep `lastActiveOrg` when present:
  // the executor's organization choice reads it (pickChatOrganizationId), as with a manual paste.
  cookieImport: {
    origin: "https://claude.ai",
    cookieNames: ["sessionKey"],
    cookiePrefixes: [],
    optionalCookies: ["lastActiveOrg"],
    extensionCapture: true,
  },
  webLogin: {
    startUrl: "https://claude.ai/",
    origin: "https://claude.ai",
    allowedHosts: [],
    cookieNames: ["sessionKey"],
    readyProbe: { url: "https://claude.ai/api/organizations", method: "GET", okStatus: [200] },
  },
  transport: { baseUrl: "https://claude.ai/api", format: "openai", executor: "claude-web", authType: "cookie" },
  models: [
    { id: "claude-fable-5-1", name: "Claude Fable 5.1 (Web)", supportsReasoning: true, supportsVision: true, contextLength: 1000000, maxOutputTokens: 128000 },
    { id: "claude-fable-5", name: "Claude Fable 5 (Web)" },
    { id: "claude-opus-5", name: "Claude Opus 5 (Web)", supportsReasoning: true, supportsVision: true, contextLength: 1000000, maxOutputTokens: 128000 },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8 (Web)" },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7 (Web)" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Web)" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5 (Web)" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (Web)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Web)" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (Web)" },
  ],
};
