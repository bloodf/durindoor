// Staged PromptQL playground provider, ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/promptql/index.ts. MIT.
// Chat uses the user's own playground enrich-token and project ID. This is an
// unofficial, experimental GraphQL integration; see docs/providers/promptql.mdx.
export const promptqlCookieProfile = Object.freeze({
  label: "PromptQL",
  origin: "https://prompt.ql.app",
  cookieDomains: Object.freeze(["prompt.ql.app", ".ql.app"]),
  cookieNames: Object.freeze(["__Host-next-auth.csrf-token", "next-auth.session-token"]),
  cookiePrefixes: Object.freeze([]),
  validationProbe: Object.freeze({ url: "https://auth.pro.ql.app/ddn/project/token", method: "POST", okStatus: [200] }),
});

export const PROMPTQL_MODELS = Object.freeze([
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", supportsVision: true },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", supportsVision: true },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", supportsVision: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", supportsVision: true },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", supportsVision: true },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", supportsVision: true },
]);

export default {
  id: "promptql", alias: "pql", priority: 249,
  display: { name: "PromptQL (Experimental)", icon: "hub", color: "#635BFF", textIcon: "PQ", website: "https://prompt.ql.app", notice: { apiKeyUrl: "https://prompt.ql.app", text: "Unofficial experimental playground session integration." } },
  category: "webCookie", authType: "cookie", authHint: "Import your PromptQL playground session, then provide its enrich-token JWT and project ID in connection details.",
  cookieImport: promptqlCookieProfile,
  webLogin: { startUrl: "https://prompt.ql.app/", origin: "https://prompt.ql.app", allowedHosts: ["auth.pro.ql.app"], cookieNames: [...promptqlCookieProfile.cookieNames], readyProbe: promptqlCookieProfile.validationProbe },
  serviceKinds: ["llm"],
  transport: { baseUrl: "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql", validateUrl: "https://auth.pro.ql.app/ddn/project/token", format: "openai", executor: "promptql", authType: "cookie", auth: { header: "Cookie", scheme: "raw" } },
  models: PROMPTQL_MODELS.map((model) => ({ ...model })),
};
