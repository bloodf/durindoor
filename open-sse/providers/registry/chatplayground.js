// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/chatplayground/index.ts.
export const chatplaygroundCookieProfile = {
  label: "ChatPlayground",
  origin: "https://app.chatplayground.ai",
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
    website: "https://app.chatplayground.ai",
    notice: { text: "Uses your ChatPlayground session cookie.", apiKeyUrl: "https://app.chatplayground.ai/" },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the Cookie header from an authenticated app.chatplayground.ai request.",
  cookieImport: chatplaygroundCookieProfile,
  webLogin: {
    startUrl: "https://app.chatplayground.ai/",
    origin: "https://app.chatplayground.ai",
    allowedHosts: ["clerk.chatplayground.ai", "web.chatplayground.ai"],
    cookieNames: ["__client", "__session"],
    readyProbe: { url: "https://app.chatplayground.ai/api/user", method: "GET", okStatus: [200] },
  },
  serviceKinds: ["llm"],
  models: [],
  passthroughModels: true,
  transport: {
    baseUrl: "https://app.chatplayground.ai/api/chat",
    validateUrl: "https://app.chatplayground.ai/api/user",
    modelsUrl: "https://app.chatplayground.ai/api/models",
    format: "openai",
    authType: "cookie",
    auth: { header: "Cookie", scheme: "raw" },
    executor: "chatplayground",
  },
  modelsFetcher: { url: "https://app.chatplayground.ai/api/models", type: "openai" },
};
