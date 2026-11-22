// Ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/notion-web/index.ts.
export const cookieCaptureProfile = Object.freeze({
  origin: "https://app.notion.com",
  domains: ["app.notion.com", "notion.so", "notion.site"],
  cookieNames: ["token_v2"],
  validationProbe: { url: "https://app.notion.com/api/v3/getSpaces", method: "POST", okStatus: [200] },
});

export default {
  id: "notion-web",
  priority: 255,
  alias: "nw",
  display: { name: "Notion AI Web", icon: "notion", color: "#000000", textIcon: "N", website: "https://www.notion.so" },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste a full Notion Cookie header or the token_v2 cookie value from app.notion.com DevTools.",
  cookieImport: { ...cookieCaptureProfile, extensionCapture: true },
  serviceKinds: ["llm"],
  transport: { baseUrl: "https://app.notion.com/api/v3/runInferenceTranscript", format: "openai", executor: "notion-web", authType: "cookie" },
  models: [{ id: "notion-ai", name: "Notion AI (default)" }],
};
