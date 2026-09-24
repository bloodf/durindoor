export default {
  id: "chatgpt-web",
  priority: 236,
  alias: "cgpt-web",
  uiAlias: "cgpt-web",
  display: {
    name: "ChatGPT Web",
    icon: "chat",
    color: "#10A37F",
    textIcon: "CG",
    website: "https://chatgpt.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the Cookie header from any chatgpt.com request, or the __Secure-next-auth.session-token value. Chunked .0/.1 session cookies are accepted.",
  serviceKinds: ["llm"],
  hiddenKinds: ["image"],
  transport: {
    baseUrl: "https://chatgpt.com/backend-api/conversation",
    format: "openai",
    executor: "chatgpt-web",
    authType: "cookie",
  },
  // Routes observed in ChatGPT's own Pro and Free web UIs (OmniRoute's list).
  // Tool calls are emulated on the HTTP transport only.
  models: [
    { id: "gpt-5-6", name: "GPT-5.6 Sol — Instant", supportsVision: true },
    {
      id: "gpt-5-6-thinking",
      name: "GPT-5.6 Sol — Thinking",
      supportsReasoning: true,
      supportsVision: true,
    },
    { id: "gpt-5-6-pro", name: "GPT-5.6 Sol — Pro", supportsReasoning: true, supportsVision: true },
    { id: "gpt-5.6-luna-free", name: "GPT-5.6 Luna — Free", supportsVision: true },
    {
      id: "gpt-5.6-luna-free-thinking",
      name: "GPT-5.6 Luna — Free Thinking",
      supportsReasoning: true,
      supportsVision: true,
    },
    { id: "gpt-5-5-instant", name: "GPT-5.5 — Instant", supportsVision: true },
    {
      id: "gpt-5-5-thinking",
      name: "GPT-5.5 — Thinking",
      supportsReasoning: true,
      supportsVision: true,
    },
    { id: "gpt-5-5-pro", name: "GPT-5.5 — Pro", supportsReasoning: true, supportsVision: true },
  ],
  imageConfig: { baseUrl: "https://chatgpt.com/backend-api/conversation" },
};
