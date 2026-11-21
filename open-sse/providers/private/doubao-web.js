// Ported from OmniRoute release/v3.8.55, open-sse/config/providers/registry/doubao/web/index.ts.
export const doubaoWebCookieProfile = {
  domains: ["www.dola.com", ".dola.com"],
  cookieNames: ["sessionid", "ttwid", "s_v_web_id"],
  validationProbe: { url: "https://www.dola.com/", method: "GET" },
};

export default {
  id: "doubao-web", alias: "doubao-web", display: { name: "Doubao Web", icon: "chat", color: "#4B72F5", textIcon: "DB", website: "https://www.dola.com" },
  category: "webCookie", authType: "cookie", authHint: "Paste the Cookie header from www.dola.com; sessionid and browser fingerprint cookies are required.",
  webLogin: { startUrl: "https://www.dola.com/", origin: "https://www.dola.com", allowedHosts: [], cookieNames: doubaoWebCookieProfile.cookieNames, readyProbe: doubaoWebCookieProfile.validationProbe },
  transport: { baseUrl: "https://www.dola.com/chat/completion", format: "openai", executor: "doubao-web", authType: "cookie" },
  models: [{ id: "dola-speed", name: "Dola Speed" }, { id: "dola-pro", name: "Dola Pro", supportsReasoning: true }], serviceKinds: ["llm"],
};
