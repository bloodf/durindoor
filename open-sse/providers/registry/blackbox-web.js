// Ported from OmniRoute release/v3.8.55 (4265bb2), open-sse/config/providers/registry/blackbox/web/index.ts.
export const blackboxWebCookieProfile = Object.freeze({ label: "Blackbox Web", origin: "https://app.blackbox.ai", cookieDomains: Object.freeze(["app.blackbox.ai"]), cookieNames: Object.freeze(["next-auth.session-token"]), cookiePrefixes: Object.freeze([]), validationProbe: Object.freeze({ url: "https://app.blackbox.ai/api/auth/session", method: "GET", okStatus: [200] }) });
export default {
  id: "blackbox-web", alias: "bb-web", priority: 259,
  display: { name: "Blackbox Web", icon: "terminal", color: "#171717", textIcon: "BB", website: "https://app.blackbox.ai" },
  category: "webCookie", authType: "cookie",
  authHint: "Paste the Cookie header or next-auth.session-token from app.blackbox.ai.",
  webLogin: { startUrl: "https://app.blackbox.ai/", origin: "https://app.blackbox.ai", cookieNames: ["next-auth.session-token"], readyProbe: { url: "https://app.blackbox.ai/api/auth/session", method: "GET", okStatus: [200] } },
  cookieImport: blackboxWebCookieProfile,
  serviceKinds: ["llm"], transport: { baseUrl: "https://app.blackbox.ai/api/chat", validateUrl: "https://app.blackbox.ai/api/auth/session", format: "openai", executor: "blackbox-web", authType: "cookie", auth: { header: "Cookie", scheme: "raw" } },
  models: ["gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "claude-3-opus", "claude-3-sonnet", "gemini-pro"].map(id => ({ id, name: id, toolCalling: false })),
};
