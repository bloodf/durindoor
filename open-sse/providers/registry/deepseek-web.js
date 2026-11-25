// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/deepseek/web/index.ts. The upstream requires
// the DeepSeek web userToken (from browser local storage), not an auth cookie.
export const DEEPSEEK_WEB_COOKIE_PROFILE = {
  domains: ["chat.deepseek.com"],
  cookieNames: [],
  validationProbe: "https://chat.deepseek.com/api/v0/users/current",
};

/**
 * Capture/import profile for the extension and the dashboard import. The credential is the
 * `userToken` localStorage item of chat.deepseek.com, not a cookie, so `cookieNames` stays empty:
 * a Cookie header, cURL or HAR carries nothing to import and the executor needs no cookie. The
 * item holds either the bare token or the site's `{"value":"...","__version":"0"}` wrapper; the
 * executor accepts both. The import API stores it in `providerSpecificData.userToken`
 * (see `apiKeyOptionalWith`), and a token pasted as the API key still wins.
 */
export const DEEPSEEK_WEB_CREDENTIAL_PROFILE = Object.freeze({
  origin: "https://chat.deepseek.com",
  domains: ["chat.deepseek.com"],
  cookieNames: [],
  localStorageKeys: ["userToken"],
  credentialPattern: "^[\\x21-\\x7e]{8,}$",
});

export default {
  id: "deepseek-web",
  priority: 249,
  alias: "ds-web",
  display: {
    name: "DeepSeek Web",
    icon: "chat",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://chat.deepseek.com",
  },
  category: "apikey",
  authType: "apikey",
  authHint: "Paste your DeepSeek web userToken from chat.deepseek.com local storage, or send it with the cookie-capture extension. Browser cookies alone are not accepted by the upstream API.",
  // An imported userToken is stored here instead of in the API-key field.
  apiKeyOptionalWith: "userToken",
  cookieImport: { ...DEEPSEEK_WEB_CREDENTIAL_PROFILE, extensionCapture: true },
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
    validateUrl: "https://chat.deepseek.com/api/v0/users/current",
    format: "openai",
    executor: "deepseek-web",
    authType: "apikey",
    authHeader: "bearer",
    // GET users/current is the read-only credential check; never fall back to a chat POST.
    quirks: { validationChatFallback: false },
  },
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsTools: true },
    { id: "deepseek-v4-pro-think", name: "DeepSeek V4 Pro Think", supportsReasoning: true, supportsTools: true },
    { id: "deepseek-v4-pro-search", name: "DeepSeek V4 Pro Search", supportsTools: true },
    { id: "deepseek-v4-pro-think-search", name: "DeepSeek V4 Pro Think+Search", supportsReasoning: true, supportsTools: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportsVision: true, supportsTools: true },
    { id: "deepseek-v4-flash-think", name: "DeepSeek V4 Flash Think", supportsReasoning: true, supportsTools: true },
    { id: "deepseek-v4-flash-search", name: "DeepSeek V4 Flash Search", supportsTools: true },
    { id: "deepseek-v4-flash-think-search", name: "DeepSeek V4 Flash Think+Search", supportsReasoning: true, supportsTools: true },
    { id: "deepseek-chat", name: "DeepSeek Chat", supportsTools: true },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner", supportsReasoning: true, supportsTools: true },
    { id: "DeepSeek-R1", name: "DeepSeek R1", supportsReasoning: true, supportsTools: true },
    { id: "DeepSeek-R1-Search", name: "DeepSeek R1 Search", supportsReasoning: true, supportsTools: true },
    { id: "DeepSeek-V3.2", name: "DeepSeek V3.2", supportsTools: true },
    { id: "DeepSeek-Search", name: "DeepSeek Search", supportsTools: true },
  ],
};
