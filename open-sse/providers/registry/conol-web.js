// Ported from OmniRoute release/v3.8.55 (4265bb2), open-sse/config/providers/registry/conol-web/index.ts.
const models = ["claude-opus-5", "claude-opus-4-8", "claude-fable-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5", "gpt-5.5", "gpt-5.5-pro", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "deepseek/deepseek-v4-pro", "openrouter/fusion", "z-ai/glm-5.2", "tencent/hy3", "moonshotai/kimi-k3", "moonshotai/kimi-k2.7-code", "qwen/qwen3.7-plus", "qwen/qwen3.7-max", "minimax/minimax-m3", "stepfun/step-3.7-flash", "google/gemini-3.7-flash", "google/gemini-3.1-pro-preview", "google/gemini-3.1-flash-lite", "x-ai/grok-4.3", "deepseek/deepseek-v4-flash", "xiaomi/mimo-v2.5", "xiaomi/mimo-v2.5-pro"];
export const conolWebCookieProfile = Object.freeze({ label: "Conol Web", origin: "https://conol.ai", cookieDomains: Object.freeze(["conol.ai"]), cookieNames: Object.freeze(["__Secure-better-auth.session_token"]), cookiePrefixes: Object.freeze([]), validationProbe: Object.freeze({ url: "https://conol.ai/api/agent-servers", method: "GET", okStatus: [200] }) });
export default {
  id: "conol-web", alias: "cnl", priority: 261,
  display: { name: "Conol Web", icon: "chat", color: "#6558D3", textIcon: "C", website: "https://conol.ai" },
  category: "webCookie", authType: "cookie", authHint: "Paste the Cookie header or __Secure-better-auth.session_token from conol.ai.",
  webLogin: { startUrl: "https://conol.ai/", origin: "https://conol.ai", cookieNames: ["__Secure-better-auth.session_token"], readyProbe: { url: "https://conol.ai/api/agent-servers", method: "GET", okStatus: [200] } },
  cookieImport: conolWebCookieProfile,
  serviceKinds: ["llm"], transport: { baseUrl: "https://conol.ai/api/sessions", validateUrl: "https://conol.ai/api/agent-servers", format: "openai", executor: "conol-web", authType: "cookie", auth: { header: "Cookie", scheme: "raw" } },
  models: models.map(id => ({ id, name: id.split("/").pop(), supportsVision: !id.startsWith("deepseek/") })), passthroughModels: true,
};
