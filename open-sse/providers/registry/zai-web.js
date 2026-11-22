// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/zai-web/index.ts.
const MODELS = [
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", supportsReasoning: true, supportsVision: true },
  { id: "glm-5.3", name: "GLM-5.3", supportsReasoning: true },
  { id: "glm-5.2", name: "GLM-5.2", supportsReasoning: true },
];

export const ZAI_WEB_COOKIE_PROFILE = Object.freeze({
  origin: "https://chat.z.ai",
  domains: ["chat.z.ai"],
  cookieNames: ["token"],
  validationProbe: { url: "https://chat.z.ai/api/models", method: "GET", okStatus: [200] },
});

export default {
  id: "zai-web",
  priority: 252,
  alias: "zai-web",
  uiAlias: "zw",
  display: { name: "Z.ai Web", icon: "hub", color: "#2563EB", textIcon: "Z.ai", website: "https://chat.z.ai" },
  category: "webCookie",
  authType: "cookie",
  authHint: 'Import the chat.z.ai session `token` cookie, or paste the token value from chat.z.ai Local Storage.',
  webLogin: {
    startUrl: "https://chat.z.ai/",
    origin: ZAI_WEB_COOKIE_PROFILE.origin,
    cookieNames: ZAI_WEB_COOKIE_PROFILE.cookieNames,
    readyProbe: ZAI_WEB_COOKIE_PROFILE.validationProbe,
  },
  transport: { baseUrl: "https://chat.z.ai/api/v2/chat/completions", format: "openai", executor: "zai-web", authType: "cookie" },
  models: MODELS,
  serviceKinds: ["llm"],
};
