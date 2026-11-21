// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/lmarena/index.ts and executors/lmarena.ts.
export const cookieCaptureProfile = Object.freeze({
  origin: "https://arena.ai", domains: ["arena.ai"],
  cookieNames: ["arena-auth-prod-v1"],
  cookiePrefixes: ["arena-auth-prod-v1."],
  validationProbe: { url: "https://arena.ai/nextjs-api/stream/create-evaluation", method: "GET", okStatus: [405] },
});
const models = [
  { id: "amazon.nova-pro-v1:0", name: "amazon.nova-pro-v1:0", contextLength: 300000, supportsVision: true },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", contextLength: 200000 },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", contextLength: 1000000, supportsVision: true },
  { id: "deepseek-v4-pro-thinking", name: "DeepSeek V4 Pro Thinking", contextLength: 1000000 },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", contextLength: 1000000, supportsVision: true },
  { id: "gpt-oss-120b", name: "GPT OSS 120B", contextLength: 131000 },
  { id: "gpt-5.2-high", name: "GPT 5.2 High", contextLength: 1000000, supportsVision: true },
];
export default {
  id: "lmarena", alias: "lma",
  display: { name: "Arena", icon: "hub", color: "#222222", textIcon: "A", website: "https://arena.ai", notice: { text: "Import your arena.ai browser session cookie. Arena may require a browser-issued reCAPTCHA token for some requests.", apiKeyUrl: "https://arena.ai/" } },
  category: "webCookie", authType: "cookie", authHint: "Import your arena.ai arena-auth-prod-v1 session cookie. Numbered Supabase cookie chunks are accepted.", cookieImport: { ...cookieCaptureProfile, extensionCapture: true },
  serviceKinds: ["llm"], transport: { baseUrl: "https://arena.ai/nextjs-api/stream/create-evaluation", format: "openai", executor: "lmarena", authType: "cookie" }, models, passthroughModels: true,
};
