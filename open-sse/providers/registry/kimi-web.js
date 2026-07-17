export default {
  id: "kimi-web",
  priority: 210,
  alias: "kimi-web",
  display: {
    name: "Kimi Web",
    icon: "chat",
    color: "#3B82F6",
    textIcon: "KW",
    website: "https://www.kimi.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste the full Cookie header from www.kimi.com (must contain kimi-auth=<JWT>).",
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat",
    // Executor emits OpenAI Chat Completions chunks/JSON (see executors/kimi-web.js).
    // Declaring the wire format as "openai" keeps the streaming/non-streaming
    // chatCore paths in passthrough mode (so `data: [DONE]` is forwarded for
    // OpenAI clients and OpenAI JSON projects back to Claude correctly) and
    // makes the generic OpenAI connection probe cover Validate/Test actions.
    format: "openai",
    executor: "kimi-web",
    authType: "cookie",
  },
  models: [
    { id: "k2d6", name: "K2.6 Instant" },
    { id: "k2d6-thinking", name: "K2.6 Thinking", supportsReasoning: true },
  ],
};
