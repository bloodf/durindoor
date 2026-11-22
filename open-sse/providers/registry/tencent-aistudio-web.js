// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/tencent-aistudio-web/index.ts.
//
// The cookie names and the validation probe path are not named by the pinned
// source (it forwards the Cookie header verbatim); confirm both against a real
// signed-in capture before relying on the narrow allowlist.
export const cookieCaptureProfile = Object.freeze({
  origin: "https://aistudio.tencent.ai",
  domains: ["aistudio.tencent.ai"],
  cookieNames: ["sessionid"],
  validationProbe: { url: "https://aistudio.tencent.ai/api/user/info", method: "GET", okStatus: [200] },
});

const models = [
  { id: "hy3-g", name: "HY3-G (via Tencent AI Studio)", toolCalling: false },
  { id: "hunyuan-default", name: "Hunyuan Default (via Tencent AI Studio)", toolCalling: false },
  { id: "hunyuan-3d", name: "Hunyuan 3D (via Tencent AI Studio)", toolCalling: false },
];

export default {
  id: "tencent-aistudio-web", alias: "tasw", priority: 257,
  display: { name: "Tencent AI Studio Web", icon: "hub", color: "#0052D9", textIcon: "TA", website: "https://aistudio.tencent.ai" },
  category: "webCookie", authType: "cookie", authHint: "Paste the Cookie header from aistudio.tencent.ai.",
  cookieImport: { ...cookieCaptureProfile, extensionCapture: true },
  webLogin: { startUrl: "https://aistudio.tencent.ai/", origin: cookieCaptureProfile.origin, allowedHosts: [], cookieNames: cookieCaptureProfile.cookieNames, readyProbe: cookieCaptureProfile.validationProbe },
  serviceKinds: ["llm"],
  transport: { baseUrl: "https://aistudio.tencent.ai/api/chat", format: "openai", executor: "tencent-aistudio-web", authType: "cookie" },
  models,
};
