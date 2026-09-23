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
  authHint:
    "Log in at www.kimi.com or www.kimi.ai, open DevTools → Console, run the snippet below and paste the copied JSON " +
    "(access_token + refresh_token from localStorage, plus the site it came from). A bare access_token or a legacy " +
    "kimi-auth Cookie header from www.kimi.com also works.",
  // DevTools console snippet shown with a Copy button in the connect dialog.
  // Kimi's web app keeps its session in localStorage, so both tokens are
  // readable from page JS; the output is the JSON `extractKimiTokens` accepts.
  // `origin` routes the connection to the deployment that issued the tokens.
  authSnippet:
    "copy(JSON.stringify({access_token:localStorage.getItem('access_token'),refresh_token:localStorage.getItem('refresh_token'),origin:location.origin}))",
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
    { id: "k3", name: "K3", supportsReasoning: true },
  ],
};
