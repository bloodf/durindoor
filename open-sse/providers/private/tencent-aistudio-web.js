// Ported from OmniRoute release/v3.8.55, Tencent AI Studio registry entry.
export const cookieCaptureProfile = Object.freeze({
  origin: "https://aistudio.tencent.ai",
  domains: ["aistudio.tencent.ai"],
  cookieNames: ["sessionid", "sessionid_ss"],
  validationProbe: { url: "https://aistudio.tencent.ai/api/user/info", method: "GET", okStatus: [200] },
});

const models = [
  { id: "hy3-g", name: "HY3-G (via Tencent AI Studio)" },
  { id: "hunyuan-default", name: "Hunyuan Default (via Tencent AI Studio)" },
  { id: "hunyuan-3d", name: "Hunyuan 3D (via Tencent AI Studio)" },
];

export default {
  id: "tencent-aistudio-web", alias: "tasw",
  display: { name: "Tencent AI Studio Web", icon: "hub", color: "#0052D9", textIcon: "TA", website: "https://aistudio.tencent.ai" },
  category: "webCookie", authType: "cookie", authHint: "Paste the Cookie header from aistudio.tencent.ai.",
  cookieImport: { ...cookieCaptureProfile, extensionCapture: true },
  webLogin: { startUrl: "https://aistudio.tencent.ai/", origin: cookieCaptureProfile.origin, allowedHosts: [], cookieNames: cookieCaptureProfile.cookieNames, readyProbe: cookieCaptureProfile.validationProbe },
  serviceKinds: ["llm"],
  transport: { baseUrl: "https://aistudio.tencent.ai/api/chat", format: "openai", executor: "tencent-aistudio-web", authType: "cookie" },
  models,
};
