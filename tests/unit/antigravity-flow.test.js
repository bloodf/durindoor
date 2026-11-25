import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ag-flow-"));
const previous = { ...process.env };
process.env.DATA_DIR = tempDir;
process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = "test-client";
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "test-secret";
// Keep the onboardUser long-running-operation poll fast so the "not settled
// yet" branch is exercised without a multi-second sleep. The product code
// reads these at call time, so setting them here is enough.
process.env.ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS = "3";
process.env.ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS = "1";

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
const calls = [];

// Mocked upstream state. Every field is reset before each test so a failing
// assertion in one test cannot leak provider state into the next one.
const state = {
  email: "a@example.test",
  loadStatus: 200,
  loadResult: { allowedTiers: [{ id: "free-tier", isDefault: true }] },
  onboardQueue: [],
  onboardFallback: { done: true, response: { cloudaicompanionProject: { id: "project-a" } } },
};

function resetState() {
  state.email = "a@example.test";
  state.loadStatus = 200;
  state.loadResult = { allowedTiers: [{ id: "free-tier", isDefault: true }] };
  state.onboardQueue = [];
  state.onboardFallback = { done: true, response: { cloudaicompanionProject: { id: "project-a" } } };
}

const providerFetch = vi.fn(async (input, options = {}) => {
  const url = String(input);
  calls.push({ url, options });
  if (url.includes("oauth2.googleapis.com/token")) {
    const refresh = options.body?.get?.("grant_type") === "refresh_token";
    return Response.json({ access_token: refresh ? "refreshed-a" : "access-a", refresh_token: "refresh-a", expires_in: 3600 });
  }
  if (url.includes("userinfo")) return Response.json({ email: state.email });
  if (url.includes(":loadCodeAssist")) return Response.json(state.loadResult, { status: state.loadStatus });
  if (url.includes(":onboardUser")) {
    const next = state.onboardQueue.length ? state.onboardQueue.shift() : state.onboardFallback;
    return Response.json(next);
  }
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
}, 60_000); // Cold route imports can exceed Vitest's default hook timeout.
beforeEach(() => {
  resetState();
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

async function signIn() {
  const start = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
  return post("exchange", { code: "code", state: start.state, flowId: start.flowId });
}

async function connectionsFor(email) {
  const all = await db.getProviderConnections({ provider: "antigravity" });
  return all.filter((connection) => connection.email === email);
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
    expect(JSON.parse(onboard.options.body).tier_id).toBe("free-tier");
    expect(new Headers(onboard.options.headers).get("authorization")).toBe("Bearer access-a");
  });

  it("lists models and serves OpenAI and Anthropic requests with the saved account", async () => {
    expect(connectionId).toBeTruthy();
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

  it("polls onboardUser until the long-running operation settles", async () => {
    state.email = "poll@example.test";
    // Google answers done:false while the account project is still being
    // provisioned; the project only appears on the settled response.
    state.onboardQueue = [
      { done: false },
      { done: false },
      { done: true, response: { cloudaicompanionProject: { id: "project-polled" } } },
    ];
    const mark = calls.length;
    const response = await signIn();
    expect(response.status).toBe(200);
    const saved = await db.getProviderConnectionById((await response.json()).connection.id);
    expect(saved.projectId).toBe("project-polled");
    const onboardCalls = calls.slice(mark).filter(({ url }) => url.includes(":onboardUser"));
    expect(onboardCalls).toHaveLength(3);
    expect(JSON.parse(onboardCalls.at(-1).options.body).tier_id).toBe("free-tier");
  });

  it.each([
    ["first poll", [], { code: 7, status: "PERMISSION_DENIED", message: "Access denied" }],
    ["after a pending poll", [{ done: false }], { code: 3, status: "INVALID_ARGUMENT", message: "Invalid project" }],
  ])("fails on an onboarding operation error on the %s", async (_label, pending, error) => {
    state.email = `operation-${error.code}@example.test`;
    state.onboardQueue = [...pending, { done: true, error }, { done: true, response: { cloudaicompanionProject: { id: "too-late" } } }];
    const mark = calls.length;
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const response = await signIn();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toContain("onboarding operation error");
    expect(body.error).toContain(`code ${error.code}`);
    expect(body.error).toContain(error.status);
    expect(body.error).toContain(error.message);
    expect(calls.slice(mark).filter(({ url }) => url.includes(":onboardUser"))).toHaveLength(pending.length + 1);
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before.length);
    expect(await connectionsFor(state.email)).toHaveLength(0);
  });

  it("stops polling at the configured bound and fails the sign-in", async () => {
    state.email = "bound@example.test";
    // Never settles within ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS (3 in this file).
    state.onboardQueue = [
      { done: false },
      { done: false },
      { done: false },
      { done: true, response: { cloudaicompanionProject: { id: "project-too-late" } } },
    ];
    const mark = calls.length;
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const response = await signIn();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("did not return a project ID");
    expect(calls.slice(mark).filter(({ url }) => url.includes(":onboardUser"))).toHaveLength(3);
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before.length);
    expect(await connectionsFor("bound@example.test")).toHaveLength(0);
  });

  it("does not save a connection when onboarding has no project", async () => {
    state.email = "no-project@example.test";
    state.onboardFallback = { done: true, response: {} };
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const response = await signIn();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("did not return a project ID");
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before.length);
    expect(await connectionsFor("no-project@example.test")).toHaveLength(0);
  });

  it("does not onboard or save when project lookup fails", async () => {
    state.email = "lookup-fail@example.test";
    state.loadStatus = 503;
    const onboardCount = calls.filter(({ url }) => url.includes(":onboardUser")).length;
    const before = await db.getProviderConnections({ provider: "antigravity" });
    const response = await signIn();
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("project lookup failed");
    expect(calls.filter(({ url }) => url.includes(":onboardUser"))).toHaveLength(onboardCount);
    expect(await db.getProviderConnections({ provider: "antigravity" })).toHaveLength(before.length);
    expect(await connectionsFor("lookup-fail@example.test")).toHaveLength(0);
  });

  it("uses an existing project without onboarding", async () => {
    state.email = "existing@example.test";
    state.loadResult = { cloudaicompanionProject: " existing-project " };
    const onboardCount = calls.filter(({ url }) => url.includes(":onboardUser")).length;
    const response = await signIn();
    expect(response.status).toBe(200);
    const saved = await db.getProviderConnectionById((await response.json()).connection.id);
    expect(saved.projectId).toBe("existing-project");
    expect(calls.filter(({ url }) => url.includes(":onboardUser"))).toHaveLength(onboardCount);
  });

  it("reuses the account row and refreshes its project on a second sign-in", async () => {
    state.email = "again@example.test";
    state.loadResult = { cloudaicompanionProject: { id: "project-first" } };
    const first = await signIn();
    expect(first.status).toBe(200);
    const firstId = (await first.json()).connection.id;
    state.loadResult = { cloudaicompanionProject: { id: "project-second" } };
    const second = await signIn();
    expect(second.status).toBe(200);
    expect((await second.json()).connection.id).toBe(firstId);
    expect(await connectionsFor("again@example.test")).toHaveLength(1);
    expect((await db.getProviderConnectionById(firstId)).projectId).toBe("project-second");
  });
});
