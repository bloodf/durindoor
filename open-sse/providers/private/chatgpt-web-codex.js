// Ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/chatgpt-web-codex/index.ts.
// Session transport follows DurinDoor's ChatGPT Web HTTP executor, which
// implements the same first-party session/Sentinel/conversation protocol.
export const cookieCaptureProfile = Object.freeze({
  origin: "https://chatgpt.com",
  domains: ["chatgpt.com"],
  cookieNames: ["__Secure-next-auth.session-token"],
  cookiePrefixes: ["__Secure-next-auth.session-token."],
  validationProbe: {
    url: "https://chatgpt.com/api/auth/session",
    method: "GET",
    okStatus: [200],
  },
});

const nativeCapabilities = {
  supportsReasoning: true,
  supportsVision: true,
};

export default {
  id: "chatgpt-web-codex",
  priority: 237,
  alias: "cgpt-codex",
  uiAlias: "cgpt-codex",
  display: {
    name: "ChatGPT Web Codex",
    icon: "chat",
    color: "#10A37F",
    textIcon: "CC",
    website: "https://chatgpt.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Import your chatgpt.com Cookie header or paste the __Secure-next-auth.session-token cookie. Numbered NextAuth session cookie chunks are accepted.",
  cookieImport: {
    ...cookieCaptureProfile,
    extensionCapture: true,
  },
  webLogin: {
    startUrl: "https://chatgpt.com/",
    origin: "https://chatgpt.com",
    allowedHosts: ["auth.openai.com"],
    cookieNames: cookieCaptureProfile.cookieNames,
    cookiePrefixes: cookieCaptureProfile.cookiePrefixes,
    readyProbe: cookieCaptureProfile.validationProbe,
  },
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/f/conversation",
    format: "openai",
    executor: "chatgpt-web-codex",
    authType: "cookie",
  },
  models: [
    { id: "luna", name: "ChatGPT Web Codex — Luna", ...nativeCapabilities },
    { id: "think", name: "ChatGPT Web Codex — Think", ...nativeCapabilities },
    { id: "instant", name: "ChatGPT Web Codex — Instant", ...nativeCapabilities },
    { id: "medium", name: "ChatGPT Web Codex — Medium", ...nativeCapabilities },
    { id: "high", name: "ChatGPT Web Codex — High", ...nativeCapabilities },
    { id: "extra-high", name: "ChatGPT Web Codex — Extra High", ...nativeCapabilities },
    { id: "pro", name: "ChatGPT Web Codex — Pro", ...nativeCapabilities },
  ],
};
