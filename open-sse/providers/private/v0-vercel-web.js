// Staged profile. Registration is intentionally owned by the integration batch.
export default {
  id: "v0-vercel-web", alias: "v0-vercel-web", priority: 244,
  display: { name: "v0 Vercel Web", icon: "auto_awesome", color: "#000000", textIcon: "V0", website: "https://v0.dev" },
  category: "webCookie", authType: "cookie", serviceKinds: ["llm"],
  authHint: "Paste __vercel_session or a Cookie header from v0.dev.",
  transport: { baseUrl: "https://v0.dev/api/chat", format: "openai", executor: "v0-vercel-web", authType: "cookie" },
  models: [{ id: "v0-default", name: "v0 Default" }],
};

/** Static discovery: upstream's executor supplies this default, not a model endpoint. */
export function discoverV0Models() {
  return [{ id: "v0-default", name: "v0 Default" }];
}
