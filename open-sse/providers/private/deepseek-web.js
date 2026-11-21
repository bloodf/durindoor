// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/config/providers/registry/deepseek/web/index.ts. The upstream requires
// the DeepSeek web userToken (from browser local storage), not an auth cookie.
export const DEEPSEEK_WEB_COOKIE_PROFILE = {
  domains: ["chat.deepseek.com"],
  cookieNames: [],
  validationProbe: "https://chat.deepseek.com/api/v0/users/current",
};

export default {
  id: "deepseek-web",
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
  authHint: "Paste your DeepSeek web userToken from chat.deepseek.com local storage. Browser cookies alone are not accepted by the upstream API.",
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0/chat/completion",
    validateUrl: "https://chat.deepseek.com/api/v0/users/current",
    format: "openai",
    executor: "deepseek-web",
    authType: "apikey",
    authHeader: "bearer",
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
