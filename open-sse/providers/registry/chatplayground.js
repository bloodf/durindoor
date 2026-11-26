// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/chatplayground/index.ts. Unified web origin: OmniRoute #20375.
export const chatplaygroundCookieProfile = {
  label: "ChatPlayground",
  origin: "https://web.chatplayground.ai",
  cookieDomains: [".chatplayground.ai"],
  cookieNames: ["__client", "__session"],
  cookiePrefixes: [],
};

export default {
  id: "chatplayground",
  alias: "cpl",
  display: {
    name: "ChatPlayground",
    icon: "chat",
    color: "#6D5CE7",
    textIcon: "CP",
    website: "https://web.chatplayground.ai",
    notice: { text: "Uses your ChatPlayground session cookie.", apiKeyUrl: "https://web.chatplayground.ai/" },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the Cookie header from an authenticated web.chatplayground.ai request.",
  cookieImport: chatplaygroundCookieProfile,
  webLogin: {
    startUrl: "https://web.chatplayground.ai/",
    origin: "https://web.chatplayground.ai",
    allowedHosts: ["clerk.chatplayground.ai", "web.chatplayground.ai"],
    cookieNames: ["__client", "__session"],
    readyProbe: { url: "https://web.chatplayground.ai/api/me", method: "GET", okStatus: [200] },
  },
  serviceKinds: ["llm"],
  models: [],
  passthroughModels: true,
  transport: {
    baseUrl: "https://web.chatplayground.ai/api/chat",
    validateUrl: "https://web.chatplayground.ai/api/me",
    modelsUrl: "https://web.chatplayground.ai/api/models",
    format: "openai",
    authType: "cookie",
    auth: { header: "Cookie", scheme: "raw" },
    executor: "chatplayground",
  },
  modelsFetcher: { url: "https://web.chatplayground.ai/api/models", type: "openai" },
};
