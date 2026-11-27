// v0 Vercel Web: a signed-in v0.dev session, registered with the `v0-vercel-web`
// executor. See docs/providers/v0-vercel-web.md. Adapted from OmniRoute
// open-sse/executors/v0-vercel-web.ts at 9671192011beb2d7f83979f40be488c5da8772b9 (MIT).
// This identity is separate from the `v0-vercel` API-key provider.
export const V0_VERCEL_WEB_ORIGIN = "https://v0.dev";

// Dashboard import (Cookie header, cURL or HAR) and extension capture of the one
// session cookie the executor accepts. No sign-in contract exists.
export const v0VercelWebCookieProfile = Object.freeze({
  origin: V0_VERCEL_WEB_ORIGIN,
  cookieNames: Object.freeze(["__vercel_session"]),
});

export default {
  id: "v0-vercel-web", alias: "v0-vercel-web", priority: 265,
  display: { name: "v0 Vercel Web", icon: "auto_awesome", color: "#000000", textIcon: "V0", website: V0_VERCEL_WEB_ORIGIN },
  category: "webCookie", authType: "cookie", serviceKinds: ["llm"],
  authHint: "Paste __vercel_session or a Cookie header from v0.dev.",
  cookieImport: v0VercelWebCookieProfile,
  transport: { baseUrl: "https://v0.dev/api/chat", format: "openai", executor: "v0-vercel-web", authType: "cookie" },
  models: [{ id: "v0-default", name: "v0 Default" }],
};

/** Static discovery: upstream's executor supplies this default, not a model endpoint. */
export function discoverV0Models() {
  return [{ id: "v0-default", name: "v0 Default" }];
}
