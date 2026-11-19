import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ag-flow-"));
const previous = { ...process.env };
process.env.DATA_DIR = tempDir;
process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = "test-client";
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "test-secret";

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => Response.json(body, init) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (...args) => providerFetch(...args),
}));

let route, db, chat, messages, models;
let connectionId;
let onboardingResult = { done: true, response: { cloudaicompanionProject: { id: "project-a" } } };
let loadStatus = 200;
let loadResult = { allowedTiers: [{ id: "free-tier", isDefault: true }] };
const calls = [];
const providerFetch = vi.fn(async (input, options = {}) => {
  const url = String(input);
  calls.push({ url, options });
  if (url.includes("oauth2.googleapis.com/token")) {
    const refresh = options.body?.get?.("grant_type") === "refresh_token";
    return Response.json({ access_token: refresh ? "refreshed-a" : "access-a", refresh_token: "refresh-a", expires_in: 3600 });
  }
  if (url.includes("userinfo")) return Response.json({ email: "a@example.test" });
  if (url.includes(":loadCodeAssist")) return Response.json(loadResult, { status: loadStatus });
  if (url.includes(":onboardUser")) return Response.json(onboardingResult);
  if (url.includes(":streamGenerateContent")) return new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  if (url.includes(":generateContent")) return Response.json({ response: { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } } });
  throw new Error(`Unexpected outbound URL: ${url}`);
});

beforeAll(async () => {
  vi.stubGlobal("fetch", providerFetch);
  route = await import("@/app/api/oauth/[provider]/[action]/route.js");
  db = await import("@/lib/localDb");
  chat = await import("@/app/api/v1/chat/completions/route.js");
  messages = await import("@/app/api/v1/messages/route.js");
  models = await import("@/app/api/v1/models/route.js");
  // Importing open-sse installs its fetch wrapper; restore the closed mock
  // afterwards so every outbound request is intercepted.
  vi.stubGlobal("fetch", providerFetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
  process.env = previous;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function post(action, body) {
  return route.POST(new Request(`http://localhost/api/oauth/antigravity/${action}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ provider: "antigravity", action }) });
}

describe("Antigravity OAuth lifecycle", () => {
  it("provisions and saves the onboarding project through the bound callback", async () => {
    const start = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
    const auth = new URL(start.authUrl);
    expect(auth.searchParams.get("client_id")).toBe("test-client");
    expect(auth.searchParams.get("state")).toBe(start.state);
    expect(auth.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/cloud-platform");
    const bad = await post("exchange", { code: "code", state: "wrong", flowId: start.flowId });
    expect(bad.status).toBe(400);
    const result = await post("exchange", { code: "code", state: start.state, flowId: start.flowId });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.success).toBe(true);
    connectionId = body.connection.id;
    const connection = await db.getProviderConnectionById(body.connection.id);
    expect(connection.email).toBe("a@example.test");
    expect(connection.projectId).toBe("project-a");
    expect(calls.some(({ url }) => url.includes(":onboardUser"))).toBe(true);
    const onboard = calls.find(({ url }) => url.includes(":onboardUser"));
    expect(JSON.parse(onboard.options.body).tierId).toBe("free-tier");
    expect(new Headers(onboard.options.headers).get("authorization")).toBe("Bearer access-a");
  });

  it("lists models and serves OpenAI and Anthropic requests with the saved account", async () => {
    const list = await models.GET(new Request("http://localhost/v1/models"));
    expect(list.status).toBe(200);
    expect((await list.json()).data.some((model) => model.id === "ag/gemini-3-flash")).toBe(true);
    for (const [handler, endpoint] of [[chat, "chat/completions"], [messages, "messages"]]) {
      for (const stream of [false, true]) {
        const response = await handler.POST(new Request(`http://localhost/v1/${endpoint}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "ag/gemini-3-flash", max_tokens: 64, stream, messages: [{ role: "user", content: "Hi" }] }),
        }));
        const text = await response.text();
        expect(response.status, text).toBe(200);
        expect(text).toContain("Hello");
        if (endpoint === "messages") expect(text).toContain(stream ? "message_start" : '"type":"message"');
        else expect(text).toContain(stream ? "chat.completion.chunk" : "chat.completion");
        const last = calls.filter(({ url }) => url.includes("GenerateContent") || url.includes("generateContent")).at(-1);
        expect(JSON.parse(last.options.body).project).toBe("project-a");
        expect(new Headers(last.options.headers).get("authorization")).toBe("Bearer access-a");
      }
    }
  });

  it("refreshes only the selected connection and retains its project", async () => {
    const other = await db.createProviderConnection({ provider: "antigravity", authType: "oauth", email: "b@example.test", accessToken: "access-b", refreshToken: "refresh-b", projectId: "project-b", isActive: false });
    await db.updateProviderConnection(connectionId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const response = await chat.POST(new Request("http://localhost/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "ag/gemini-3-flash", messages: [{ role: "user", content: "Hi" }] }),
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    const refreshed = await db.getProviderConnectionById(connectionId);
    expect(refreshed.accessToken).toBe("refreshed-a");
    expect(refreshed.projectId).toBe("project-a");
    expect(await db.getProviderConnectionById(other.id)).toMatchObject({ accessToken: "access-b", refreshToken: "refresh-b", projectId: "project-b" });
    const tokenCall = calls.findLast(({ url, options }) => url.includes("oauth2.googleapis.com/token") && options.body?.get?.("grant_type") === "refresh_token");
    expect(tokenCall.options.body.get("refresh_token")).toBe("refresh-a");
    const sent = calls.filter(({ url }) => url.includes("GenerateContent") || url.includes("generateContent")).at(-1);
    expect(JSON.parse(sent.options.body).project).toBe("project-a");
    expect(new Headers(sent.options.headers).get("authorization")).toBe("Bearer refreshed-a");
  });

  it("does not save a connection when onboarding has no project", async () => {
    onboardingResult = { done: true, response: {} };
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const start = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
    const response = await post("exchange", { code: "code", state: start.state, flowId: start.flowId });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("did not return a project ID");
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before.length);
  });

  it("does not onboard or save when project lookup fails", async () => {
    loadStatus = 503;
    const onboardCount = calls.filter(({ url }) => url.includes(":onboardUser")).length;
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const start = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
    const response = await post("exchange", { code: "code", state: start.state, flowId: start.flowId });
    expect(response.status).toBe(502);
    expect(calls.filter(({ url }) => url.includes(":onboardUser"))).toHaveLength(onboardCount);
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before.length);
    loadStatus = 200;
  });

  it("uses an existing project without onboarding", async () => {
    loadResult = { cloudaicompanionProject: " existing-project " };
    const onboardCount = calls.filter(({ url }) => url.includes(":onboardUser")).length;
    const start = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
    const response = await post("exchange", { code: "code", state: start.state, flowId: start.flowId });
    expect(response.status).toBe(200);
    const saved = await db.getProviderConnectionById((await response.json()).connection.id);
    expect(saved.projectId).toBe("existing-project");
    expect(calls.filter(({ url }) => url.includes(":onboardUser"))).toHaveLength(onboardCount);
  });
});
