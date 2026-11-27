// Venice Web: a signed-in venice.ai browser session. STAGED: nothing in the
// registry or the executor map imports this module yet, so it is unavailable to
// users. See docs/providers/venice-web.md.
//
// Origins, the cookie name, endpoints and the model list come from
// cheaper-inference/OmniRoute at 9671192011beb2d7f83979f40be488c5da8772b9
// (MIT): open-sse/executors/venice-web.ts, open-sse/executors/venice-web-auth.ts,
// src/lib/providers/staticModels.ts and
// src/shared/providers/webSessionCredentials.ts.
//
// This identity is separate from the `venice` API-key provider. The two never
// share a connection, a stored credential or a destination host.

export const VENICE_WEB_ID = "venice-web";
export const VENICE_WEB_ALIAS = "venw";
export const VENICE_WEB_ORIGIN = "https://venice.ai";
export const VENICE_WEB_CLERK_ORIGIN = "https://clerk.venice.ai";

// With the session-token URL built from a checked session id, these are the only
// destinations any Venice Web credential is ever sent to.
export const VENICE_WEB_CLIENT_URL = `${VENICE_WEB_CLERK_ORIGIN}/v1/client`;
export const veniceWebTokenUrl = (sessionId) => `${VENICE_WEB_CLIENT_URL}/sessions/${sessionId}/tokens`;
export const VENICE_WEB_CHAT_URL = "https://outerface.venice.ai/api/inference/chat";

export const VENICE_WEB_CREDENTIAL_HINT =
  "Copy the `__client` cookie of clerk.venice.ai while signed in at venice.ai. A Venice API key does not work here.";

// Dashboard cookie import only. The pinned source defines no extension capture
// and no sign-in or session-ready contract, so there is no `webLogin` profile.
export const veniceWebCookieProfile = Object.freeze({
  origin: VENICE_WEB_CLERK_ORIGIN,
  cookieNames: Object.freeze(["__client"]),
  extensionCapture: false,
});

// The pinned source's static list. Venice has no known model listing for this
// session type, so the list says nothing about what an account can use.
export const VENICE_WEB_MODELS = Object.freeze([
  ["venice-uncensored", "Venice Uncensored"],
  ["llama-3.3-70b", "Llama 3.3 70B"],
  ["qwen3-235b", "Qwen3 235B"],
  ["qwen3-4b", "Qwen3 4B"],
  ["deepseek-r1-671b", "DeepSeek R1 671B"],
].map(([id, name]) => Object.freeze({ id, name: `${name} (via Venice Web)`, toolCalling: false })));

export default {
  id: VENICE_WEB_ID,
  alias: VENICE_WEB_ALIAS,
  uiAlias: VENICE_WEB_ALIAS,
  priority: 263,
  display: {
    name: "Venice Web",
    icon: "shield",
    color: "#DC2626",
    textIcon: "VW",
    website: VENICE_WEB_ORIGIN,
  },
  category: "webCookie",
  authType: "cookie",
  authHint: VENICE_WEB_CREDENTIAL_HINT,
  cookieImport: veniceWebCookieProfile,
  serviceKinds: ["llm"],
  transport: {
    baseUrl: VENICE_WEB_CHAT_URL,
    format: "openai",
    executor: VENICE_WEB_ID,
    authType: "cookie",
  },
  models: VENICE_WEB_MODELS.map((model) => ({ ...model })),
  passthroughModels: true,
};
