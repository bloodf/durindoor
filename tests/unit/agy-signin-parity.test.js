import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-parity-"));
const previous = { ...process.env };
process.env.DATA_DIR = dir;
process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = "synthetic-client";
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "synthetic-secret";
fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({ providerConnections: [{ id: "imported-agy", provider: "agy", authType: "oauth", email: "same@example.test", accessToken: "imported-old", refreshToken: "imported-refresh", projectId: "imported-project", isActive: true }] }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: (...args) => outbound(...args) }));
const calls = [];
const outbound = vi.fn(async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url.includes("oauth2.googleapis.com/token")) return Response.json(init.body.get("grant_type") === "refresh_token" ? { access_token: "imported-new", expires_in: 3600 } : { access_token: "signed-in", refresh_token: "signed-refresh", expires_in: 3600 });
  if (url.includes("userinfo")) return Response.json({ email: "same@example.test" });
  if (url.includes(":loadCodeAssist")) return Response.json({ cloudaicompanionProject: "signed-project" });
  if (url.includes(":fetchAvailableModels")) return new Headers(init.headers).get("authorization") === "Bearer imported-old" ? new Response("expired", { status: 401 }) : Response.json({ models: { "gemini-3-flash": { displayName: "Flash" } } });
  if (url.includes(":streamGenerateContent")) return new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  throw new Error(`Unexpected outbound URL: ${url}`);
});
let db, oauth, chat, catalog;
beforeAll(async () => {
  vi.stubGlobal("fetch", outbound);
  db = await import("@/lib/localDb");
  oauth = await import("@/app/api/oauth/[provider]/[action]/route.js");
  chat = await import("@/app/api/v1/chat/completions/route.js");
  catalog = (await import("@/app/api/providers/[id]/models/modelsConfig.js")).PROVIDER_MODELS_CONFIG;
  vi.stubGlobal("fetch", outbound);
});
afterAll(() => { vi.unstubAllGlobals(); process.env = previous; fs.rmSync(dir, { recursive: true, force: true }); });
async function post(action, body) {
  return oauth.POST(new Request(`http://localhost/api/oauth/antigravity/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider: "antigravity", action }) });
}
describe("agy imported connection and Antigravity OAuth", () => {
  it("keeps accounts separate through catalog refresh and streaming", async () => {
    const imported = await db.getProviderConnectionById("imported-agy");
    expect(imported).toMatchObject({ provider: "agy", projectId: "imported-project", refreshToken: "imported-refresh" });
    const start = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
    const response = await post("exchange", { code: "synthetic-code", state: start.state, flowId: start.flowId });
    expect(response.status).toBe(200);
    const signedId = (await response.json()).connection.id;
    expect(await db.getProviderConnectionById(signedId)).toMatchObject({ provider: "antigravity", email: "same@example.test", projectId: "signed-project", accessToken: "signed-in" });
    const result = await catalog.agy.customResolver(imported);
    expect(result.models).toEqual([{ id: "gemini-3-flash", name: "Flash" }]);
    const token = calls.find(({ url, init }) => url.includes("oauth2.googleapis.com/token") && init.body.get("grant_type") === "refresh_token");
    expect(Object.fromEntries(token.init.body)).toMatchObject({ client_id: "synthetic-client", client_secret: "synthetic-secret", refresh_token: "imported-refresh" });
    expect(await db.getProviderConnectionById("imported-agy")).toMatchObject({ accessToken: "imported-new", refreshToken: "imported-refresh", projectId: "imported-project" });
    expect(await db.getProviderConnectionById(signedId)).toMatchObject({ accessToken: "signed-in", refreshToken: "signed-refresh", projectId: "signed-project" });
    const stream = await chat.POST(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "agy/gemini-3-flash", stream: true, messages: [{ role: "user", content: "Hi" }] }) }));
    const text = await stream.text();
    expect(stream.status, text).toBe(200);
    expect(text).toContain("Hello");
    const sent = calls.findLast(({ url }) => url.includes(":streamGenerateContent"));
    expect(new Headers(sent.init.headers).get("authorization")).toBe("Bearer imported-new");
    expect(JSON.parse(sent.init.body).project).toBe("imported-project");
    const agStream = await chat.POST(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "ag/gemini-3-flash", stream: true, messages: [{ role: "user", content: "Hi" }] }) }));
    expect(await agStream.text()).toContain("Hello");
    expect(agStream.status).toBe(200);
    const agSent = calls.findLast(({ url }) => url.includes(":streamGenerateContent"));
    expect(new Headers(agSent.init.headers).get("authorization")).toBe("Bearer signed-in");
    expect(JSON.parse(agSent.init.body).project).toBe("signed-project");
  });
});
