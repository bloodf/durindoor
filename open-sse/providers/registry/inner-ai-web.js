// Inner.ai Web: a signed-in app.innerai.com session, registered with the
// `inner-ai-web` executor. See docs/providers/inner-ai-web.md.
//
// Origins, the cookie name, endpoints and the fallback catalog come from
// cheaper-inference/OmniRoute at 9671192011beb2d7f83979f40be488c5da8772b9
// (MIT): open-sse/executors/inner-ai.ts,
// open-sse/config/providers/registry/inner-ai/index.ts and
// src/shared/providers/webSessionCredentials.ts.
//
// This identity is separate from the `inner-ai` API-key category entry. The two
// never share a connection or a stored credential.

export const INNER_AI_WEB_ID = "inner-ai-web";
export const INNER_AI_WEB_ALIAS = "inaw";
export const INNER_AI_WEB_ORIGIN = "https://app.innerai.com";

// The only destinations the session credential is ever sent to.
export const INNER_AI_WEB_CHAT_URL = "https://chatapi.innerai.com/chat";
export const INNER_AI_WEB_PROFILE_URL = "https://platformapi.innerai.com/api/v1/users/profile";
export const INNER_AI_WEB_MODELS_URL = "https://platformapi.innerai.com/api/v1/ai_models";

export const INNER_AI_WEB_CREDENTIAL_HINT =
  "Copy the `token` cookie for .innerai.com while signed in at app.innerai.com, optionally followed by a space and your login email: eyJ... user@example.com";

// Dashboard import (Cookie header, cURL or HAR) and extension capture of the one
// `token` cookie of app.innerai.com (the cookie may be scoped to .innerai.com).
// The account email is never read from the browser: the operator may type it in
// the dashboard, where it is validated and bound to the one-use pairing on the
// server, then appended as `token=<jwt> <email>`. Left blank, the token is
// stored alone and the executor falls back to the profile lookup. There is no
// `webLogin` profile: the pinned source defines no sign-in contract.
export const innerAiWebCookieProfile = Object.freeze({
  origin: INNER_AI_WEB_ORIGIN,
  cookieNames: Object.freeze(["token"]),
  accountEmail: "optional",
});

// Fallback catalog from the pinned registry. What an account can really use is
// decided by discovery and by its plan.
const MODELS = [
  ["gpt-4o", "GPT-4o"],
  ["gpt-4.1", "GPT-4.1"],
  ["gpt-4.1-mini", "GPT-4.1 Mini"],
  ["o3", "o3", true],
  ["o4-mini", "o4-mini", true],
  ["claude-opus-4-5", "Claude Opus 4.5"],
  ["claude-sonnet-4-5", "Claude Sonnet 4.5"],
  ["claude-3-7-sonnet-20250219", "Claude 3.7 Sonnet"],
  ["claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash"],
  ["deepseek-r1", "DeepSeek R1", true],
  ["deepseek-v3", "DeepSeek V3"],
  ["grok-3", "Grok 3"],
  ["grok-3-mini", "Grok 3 Mini", true],
  ["llama-4-maverick", "Llama 4 Maverick"],
  ["llama-3.3-70b-instruct", "Llama 3.3 70B"],
  ["mistral-large-2411", "Mistral Large"],
];

export default {
  id: INNER_AI_WEB_ID,
  alias: INNER_AI_WEB_ALIAS,
  uiAlias: INNER_AI_WEB_ALIAS,
  priority: 262,
  display: {
    name: "Inner.ai Web",
    icon: "inner-ai.svg",
    color: "#1A56DB",
    textIcon: "IA",
    website: INNER_AI_WEB_ORIGIN,
  },
  category: "webCookie",
  authType: "cookie",
  authHint: INNER_AI_WEB_CREDENTIAL_HINT,
  cookieImport: innerAiWebCookieProfile,
  serviceKinds: ["llm"],
  transport: {
    baseUrl: INNER_AI_WEB_CHAT_URL,
    format: "openai",
    executor: INNER_AI_WEB_ID,
    authType: "cookie",
  },
  models: MODELS.map(([id, name, reasoning]) => ({
    id,
    name: `${name} (via Inner.ai Web)`,
    ...(reasoning ? { supportsReasoning: true } : null),
  })),
  passthroughModels: true,
};
