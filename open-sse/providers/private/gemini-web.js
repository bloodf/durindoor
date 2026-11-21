// Gemini Web (https://gemini.google.com): the user's own signed-in session,
// supplied as Google cookies through the cookie-capture extension or the
// dashboard import. Chat runs in the gemini-web executor
// (open-sse/executors/gemini-web.js), which drives the signed-in page and
// reads the page's own StreamGenerate answer.
//
// Ported from OmniRoute release/v3.8.55
// (4265bb2ad5477450a07d3a43ea33a62c6c874878):
// open-sse/config/providers/registry/gemini/web/index.ts. MIT.
//
// Staged module: not in open-sse/providers/registry/index.js yet, and the
// executor is not in open-sse/executors/index.js. The registration steps are
// listed at the end of docs/providers/gemini-web.mdx.
//
// The Argon model upstream gates behind OMNIROUTE_GEMINI_WEB_ARGON_ENABLED has
// unvalidated mode-selection selectors, so it is not ported.

/** Cookies the session needs. Both must be present for an import to be accepted. */
export const GEMINI_WEB_COOKIE_NAMES = Object.freeze(["__Secure-1PSID", "__Secure-1PSIDTS"]);

/**
 * Cookie capture/import profile. `origin` and `cookieNames` are what the
 * extension and the dashboard import approve; `validationProbe` is the
 * read-only session check (validateGeminiWebSession in the executor module).
 */
export const geminiWebCookieProfile = Object.freeze({
  label: "Gemini Web",
  origin: "https://gemini.google.com",
  // Google sets these on .google.com; the import contract allows a parent domain of the origin host.
  cookieDomains: Object.freeze([".google.com"]),
  cookieNames: GEMINI_WEB_COOKIE_NAMES,
  cookiePrefixes: Object.freeze([]),
  // Rotated by Google while a session is open; the executor writes them back.
  rotatingCookieNames: Object.freeze(["__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC"]),
  validationProbe: Object.freeze({
    url: "https://gemini.google.com/app",
    method: "GET",
    redirect: "manual",
    // A signed-in page carries this token; a signed-out landing page answers 200 to any junk cookie.
    signedInMarker: '"SNlM0e"',
    expiredRedirect: "accounts.google.com/ServiceLogin",
  }),
});

// Native tool calling is off: the UI is driven by a typed prompt, so tool calls are
// prompt-emulated (<tool>{...}</tool>) and reasoning content is never surfaced.
export const GEMINI_WEB_MODELS = Object.freeze([
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", toolCalling: false, supportsReasoning: false },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", toolCalling: false, supportsReasoning: false },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", toolCalling: false, supportsReasoning: false },
]);

export default {
  id: "gemini-web",
  alias: "gweb",
  uiAlias: "gweb",
  display: {
    name: "Gemini Web (Subscription)",
    icon: "auto_awesome",
    color: "#4285F4",
    textIcon: "GW",
    website: "https://gemini.google.com",
  },
  category: "webCookie",
  authType: "cookie",
  authHint:
    "Paste the Cookie header from any gemini.google.com request, or the __Secure-1PSID and __Secure-1PSIDTS values.",
  webLogin: {
    startUrl: "https://gemini.google.com/app",
    origin: "https://gemini.google.com",
    allowedHosts: ["accounts.google.com"],
    cookieNames: [...GEMINI_WEB_COOKIE_NAMES],
    readyProbe: {
      url: "https://gemini.google.com/app",
      method: "GET",
      okStatus: [200],
    },
  },
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://gemini.google.com/app",
    // The executor returns OpenAI Chat Completions JSON and SSE.
    format: "openai",
    executor: "gemini-web",
    authType: "cookie",
  },
  models: GEMINI_WEB_MODELS.map((model) => ({ ...model })),
};
