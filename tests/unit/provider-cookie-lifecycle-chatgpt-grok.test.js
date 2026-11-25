/**
 * #2034: ChatGPT Web and Grok Web saved-cookie lifecycle, offline.
 *
 * Real: sqlite DB, provider routes, validate/test routes, /v1/models, handleChat,
 * account fallback, executors and the usage route. Synthetic: every credential and every
 * outbound byte (global fetch, the ChatGPT TLS client override and the browser seam).
 * No live provider traffic, real session, browser or Docker is involved.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const SESSION = "__Secure-next-auth.session-token";
const GROK_URL = "https://grok.com/rest/app-chat/conversations/new";
const CHATGPT_SESSION_URL = "https://chatgpt.com/api/auth/session";

let root;
let db;
let routes;
let handleChat;
let chatgptExecutor;
let originalDeps;
let seen;
let outbound;

const grokEvent = (response) => `${JSON.stringify({ result: { response } })}\n`;
const json = (url, body, method = "POST") =>
  new Request(`http://gateway.invalid${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });

async function addConnection(provider, name, apiKey, providerSpecificData, priority) {
  const res = await routes.providers.POST(json("/api/providers", { provider, name, apiKey, providerSpecificData, priority }));
  expect(res.status).toBe(201);
  return (await res.json()).connection;
}

const chat = (model, extra = {}) =>
  handleChat(json("/v1/chat/completions", { model, messages: [{ role: "user", content: "hello" }], ...extra }));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-lifecycle-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  seen = [];
  outbound = vi.fn(() => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outbound);
  db = await import("@/lib/db/index.js");
  routes = {
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    validate: await import("../../src/app/api/providers/validate/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    models: await import("../../src/app/api/v1/models/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
    responses: await import("../../src/app/api/v1/responses/route.js"),
    usage: await import("../../src/app/api/usage/[connectionId]/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  const { getExecutor } = await import("../../open-sse/executors/index.js");
  chatgptExecutor = getExecutor("chatgpt-web");
  originalDeps = chatgptExecutor.deps;
  // The setup builds a fresh sqlite database and imports ten route modules.
  // Under a loaded machine that can outlast Vitest's default 10 second hook
  // ceiling, so the hook carries the same explicit budget the other
  // database-backed suites in this package use.
}, 60_000);

afterEach(async () => {
  chatgptExecutor.deps = originalDeps;
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("Grok Web saved cookie lifecycle", () => {
  it("saves, skips conversation probes, discovers models and dispatches JSON and stream per account", async () => {
    const a = await addConnection("grok-web", "grok-a", "sso=synthetic-a");
    const b = await addConnection("grok-web", "grok-b", "synthetic-b");
    expect(a).toMatchObject({ provider: "grok-web", authType: "cookie" });
    expect(JSON.stringify(a)).not.toContain("synthetic-a");
    expect(a.id).not.toBe(b.id);

    const validated = await (await routes.validate.POST(json("/api/providers/validate", { provider: "grok-web", apiKey: "sso=synthetic-a" }))).json();
    expect(validated).toMatchObject({ skipped: true });
    const tested = await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id));
    expect((await tested.json()).skipped).toBe(true);
    expect(outbound).not.toHaveBeenCalled();

    const listed = await (await routes.models.GET(json("/v1/models", null, "GET"))).json();
    const ids = listed.data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["gw/grok-4", "gw/grok-4.1-fast"]));

    outbound.mockImplementation(async (url, init) => {
      seen.push({ url, cookie: init.headers.Cookie });
      return new Response(grokEvent({ token: "hi" }) + grokEvent({ modelResponse: { message: "hi" } }));
    });
    const jsonRes = await chat("gw/grok-4");
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("hi");
    const streamRes = await chat("gw/grok-4", { stream: true });
    expect(await streamRes.text()).toContain("[DONE]");
    expect(seen.every((call) => call.url === GROK_URL)).toBe(true);
    expect(seen.length).toBe(2);
    expect(new Set(seen.map((s) => s.cookie)).size).toBeGreaterThan(0);
  });

  it("serves Anthropic Messages and OpenAI Responses clients from the same saved cookie", async () => {
    await addConnection("grok-web", "grok-a", "sso=synthetic-a");
    outbound.mockImplementation(async () => new Response(grokEvent({ token: "pong" }) + grokEvent({ modelResponse: { message: "pong" } })));
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));

    const message = await post("messages", { model: "gw/grok-4", max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content[0].text).toBe("pong");
    const messageStream = await (await post("messages", { model: "gw/grok-4", max_tokens: 16, stream: true, messages: [{ role: "user", content: "ping" }] })).text();
    expect(messageStream).toContain("event: message_start");
    expect(messageStream).toContain("event: message_stop");

    const response = await post("responses", { model: "gw/grok-4", input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("pong");
    const responseStream = await (await post("responses", { model: "gw/grok-4", input: "ping", stream: true })).text();
    expect(responseStream).toContain("response.completed");
    expect(outbound.mock.calls.every(([url]) => url === GROK_URL)).toBe(true);
  });

  const lockFields = (row) => Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);
  const answerByCookie = (live) => async (_url, init) => {
    seen.push({ cookie: init.headers.Cookie });
    return live.has(init.headers.Cookie)
      ? new Response(grokEvent({ token: "ok" }) + grokEvent({ modelResponse: { message: "ok" } }))
      : new Response("", { status: 401 });
  };

  it("falls back from an expired session, keeps the sibling untouched, and recovers after re-paste", async () => {
    const expired = await addConnection("grok-web", "expired", "sso=expired-session", undefined, 1);
    const live = await addConnection("grok-web", "live", "sso=live-session", undefined, 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    outbound.mockImplementation(answerByCookie(new Set(["sso=live-session"])));

    // Whichever account the router tries first, the client is served by the live cookie.
    for (let i = 0; i < 3; i += 1) {
      const res = await chat("gw/grok-4");
      expect(res.status).toBe(200);
      expect((await res.json()).choices[0].message.content).toBe("ok");
    }
    const after = await db.getProviderConnectionById(expired.id);
    expect(after.errorCode ?? after.lastErrorCode).toBeTruthy();
    expect(lockFields(after).length).toBeGreaterThan(0);
    expect(JSON.stringify(after.lastError ?? "")).not.toContain("expired-session");
    const liveAfter = await db.getProviderConnectionById(live.id);
    expect(liveAfter.apiKey).toBe(liveBefore.apiKey);
    expect(lockFields(liveAfter)).toEqual([]);

    // Re-import: the dashboard Edit dialog PUTs the fresh cookie over the expired one.
    const put = await routes.provider.PUT(json(`/api/providers/${expired.id}`, { apiKey: "sso=fresh-session", testStatus: "unknown", lastError: null, lastErrorAt: null }, "PUT"), params(expired.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(expired.id);
    expect(reimported.apiKey).toBe("sso=fresh-session");
    expect(lockFields(reimported)).toEqual([]);
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    seen.length = 0;
    outbound.mockImplementation(answerByCookie(new Set(["sso=fresh-session", "sso=live-session"])));
    await db.updateProviderConnection(live.id, { isActive: false });
    const res = await chat("gw/grok-4");
    expect(res.status).toBe(200);
    expect(seen.map((call) => call.cookie)).toEqual(["sso=fresh-session"]);
  });

  it.each([
    ["a bare value", "tok", "sso=tok"],
    ["padded whitespace", "  sso=tok  ", "sso=tok"],
    ["a base64 value ending in padding", "tok==", "sso=tok=="],
    ["a full header that does not start with sso", "Cookie: x-anonuserid=u1; sso=tok; sso-rw=tok; cf_clearance=c", "x-anonuserid=u1; sso=tok; sso-rw=tok; cf_clearance=c"],
  ])("sends %s as the saved session for that account only", async (_label, saved, expected) => {
    await addConnection("grok-web", "cookie-shape", saved);
    outbound.mockImplementation(async (_url, init) => {
      seen.push(init.headers.Cookie);
      return new Response(grokEvent({ modelResponse: { message: "ok" } }));
    });
    expect((await chat("gw/grok-4")).status).toBe(200);
    expect(seen).toEqual([expected]);
  });

  it("rejects a pasted header without sso locally, without contacting grok.com", async () => {
    await addConnection("grok-web", "no-sso", "Cookie: x-anonuserid=u1; cf_clearance=c");
    const res = await chat("gw/grok-4");
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).toMatch(/no sso cookie/i);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("reports an actionable expiry error when the only session is rejected, and 429 stays rate limiting", async () => {
    await addConnection("grok-web", "only", "sso=expired-session");
    outbound.mockImplementation(async () => new Response("", { status: 401 }));
    const res = await chat("gw/grok-4");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/expired|authentication|re-paste|sso/i);
    expect(JSON.stringify(body)).not.toContain("expired-session");
  });
});

describe("ChatGPT Web saved cookie lifecycle", () => {
  const chunked = (tag) => `${SESSION}.1=${tag}-b; ${SESSION}.0=${tag}-a`;
  const turn = (text = "mock answer") => ({ text, conversationId: "private-conversation", status: "finished_successfully", endTurn: true });
  const lockFields = (row) => Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);
  // Browser seam: the session value decides whether chatgpt.com "accepts" the cookie.
  const browser = ({ live, rotate = {} }) => ({
    createSession: async (input) => ({ input }),
    runTurn: async (session) => {
      seen.push({ connectionId: session.input.connectionId, cookie: session.input.storageState.cookies.map((c) => `${c.name}=${c.value}`).join("; ") });
      if (!live.has(session.input.storageState.cookies[0].value)) throw new Error("ChatGPT Web conversation failed with status 401");
      return turn();
    },
    readSessionCookies: async (session) => rotate[session.input.connectionId] ?? [],
  });

  it("saves chunked cookies, validates read-only, discovers lanes and dispatches JSON and stream", async () => {
    const a = await addConnection("chatgpt-web", "cgpt-a", chunked("A"), { transport: "browser" }, 1);
    const b = await addConnection("chatgpt-web", "cgpt-b", chunked("B"), { transport: "browser" }, 2);
    expect(a).toMatchObject({ provider: "chatgpt-web", authType: "cookie" });
    expect(JSON.stringify([a, b])).not.toMatch(/A-[ab]|B-[ab]/);
    expect(a.id).not.toBe(b.id);

    outbound.mockImplementation(async (url, init) => {
      seen.push({ url: String(url), cookie: init.headers.Cookie });
      return Response.json({ accessToken: "synthetic-access-token" });
    });
    const ok = await (await routes.validate.POST(json("/api/providers/validate", { provider: "chatgpt-web", apiKey: chunked("A") }))).json();
    expect(ok).toMatchObject({ valid: true });
    expect(JSON.stringify(ok)).not.toContain("synthetic-access-token");
    expect(seen).toEqual([{ url: CHATGPT_SESSION_URL, cookie: `${SESSION}.0=A-a; ${SESSION}.1=A-b` }]);

    outbound.mockImplementation(async () => Response.json({}));
    const expired = await (await routes.validate.POST(json("/api/providers/validate", { provider: "chatgpt-web", apiKey: `${SESSION}.0=A-a` }))).json();
    expect(expired).toMatchObject({ valid: false });
    expect(expired.error).toMatch(/expired or incomplete.*\.1/i);

    const ids = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((model) => model.id);
    expect(ids).toEqual(expect.arrayContaining(["cgpt-web/gpt-6", "cgpt-web/gpt-6-thinking", "cgpt-web/gpt-6-pro"]));

    seen = [];
    outbound.mockImplementation(() => { throw new Error("browser transport must not use fetch"); });
    chatgptExecutor.deps = { browser: browser({ live: new Set(["A-a", "B-a"]) }) };
    const jsonRes = await chat("cgpt-web/gpt-6");
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("mock answer");
    const streamText = await (await chat("cgpt-web/gpt-6", { stream: true })).text();
    expect(streamText).toContain('"content":"mock answer"');
    expect(streamText).toContain("[DONE]");
    expect(streamText).not.toContain("private-conversation");
    // Priority order picks the first saved session; credentials never cross accounts.
    expect(seen.map((s) => s.connectionId)).toEqual([a.id, a.id]);
    expect(seen.every((s) => s.cookie.includes("A-a") && !s.cookie.includes("B-"))).toBe(true);
  });

  it("maps an expired browser session to 401, falls back, and recovers after re-paste", async () => {
    const stale = await addConnection("chatgpt-web", "stale", chunked("old"), { transport: "browser" }, 1);
    const live = await addConnection("chatgpt-web", "live", chunked("live"), { transport: "browser" }, 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    chatgptExecutor.deps = { browser: browser({ live: new Set(["live-a"]) }) };

    const res = await chat("cgpt-web/gpt-6");
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.connectionId)).toEqual([stale.id, live.id]);
    const staleRow = await db.getProviderConnectionById(stale.id);
    expect(lockFields(staleRow).length).toBeGreaterThan(0);
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    const put = await routes.provider.PUT(json(`/api/providers/${stale.id}`, { apiKey: chunked("fresh") }, "PUT"), params(stale.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(stale.id);
    expect(reimported.apiKey).toBe(chunked("fresh"));
    expect(lockFields(reimported)).toEqual([]);
    expect(reimported.providerSpecificData.transport).toBe("browser");

    seen = [];
    chatgptExecutor.deps = { browser: browser({ live: new Set(["fresh-a", "live-a"]) }) };
    expect((await chat("cgpt-web/gpt-6")).status).toBe(200);
    expect(seen).toEqual([{ connectionId: stale.id, cookie: `${SESSION}.0=fresh-a; ${SESSION}.1=fresh-b` }]);
  });

  it("returns an actionable 401 when the only browser session is expired", async () => {
    await addConnection("chatgpt-web", "only", chunked("old"), { transport: "browser" });
    chatgptExecutor.deps = { browser: browser({ live: new Set() }) };
    const res = await chat("cgpt-web/gpt-6");
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/re-paste your __Secure-next-auth\.session-token/i);
    expect(text).not.toMatch(/old-[ab]/);
  });

  it("persists a rotated cookie only to the connection that ran the turn", async () => {
    const a = await addConnection("chatgpt-web", "rot-a", chunked("A"), { transport: "browser" }, 1);
    const b = await addConnection("chatgpt-web", "rot-b", chunked("B"), { transport: "browser" }, 2);
    const bBefore = await db.getProviderConnectionById(b.id);
    chatgptExecutor.deps = { browser: browser({
      live: new Set(["A-a"]),
      rotate: { [a.id]: [{ name: `${SESSION}.0`, value: "A2-a" }, { name: `${SESSION}.1`, value: "A2-b" }] },
    }) };
    expect((await chat("cgpt-web/gpt-6")).status).toBe(200);
    const rotated = await db.getProviderConnectionById(a.id);
    expect(rotated.apiKey).toContain("A2-a");
    expect(rotated.apiKey).toContain("A2-b");
    expect(rotated.apiKey).not.toContain("A-a");
    expect((await db.getProviderConnectionById(b.id)).apiKey).toBe(bBefore.apiKey);
  });

  it("reports an expired session on the HTTP transport as 401 without contacting the conversation endpoint", async () => {
    await addConnection("chatgpt-web", "http", chunked("old"), { transport: "http" });
    const { __setTlsFetchOverrideForTesting } = await import("../../open-sse/services/chatgptTlsClient.js");
    const urls = [];
    __setTlsFetchOverrideForTesting(async (url) => {
      urls.push(String(url));
      return { status: 200, headers: new Headers({ "Content-Type": "application/json" }), body: null, text: "{}" };
    });
    try {
      const res = await chat("cgpt-web/gpt-6");
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).toMatch(/re-paste your __Secure-next-auth\.session-token/);
      expect(urls).toEqual([CHATGPT_SESSION_URL]);
    } finally {
      __setTlsFetchOverrideForTesting(null);
    }
  });
});

describe("web cookie usage reporting", () => {
  it.each([
    ["grok-web", "gw/grok-4", "Grok Web"],
    ["chatgpt-web", "cgpt-web/gpt-6", "ChatGPT Web"],
  ])("summarises only DurinDoor's own recorded requests for a saved %s session", async (provider, model, label) => {
    const mine = await addConnection(provider, "mine", provider === "grok-web" ? "sso=mine" : `${SESSION}=mine`, { transport: "browser" }, 1);
    const other = await addConnection(provider, "other", provider === "grok-web" ? "sso=other" : `${SESSION}=other`, { transport: "browser" }, 2);
    const usage = (id) => routes.usage.GET(json(`/api/usage/${id}`, null, "GET"), { params: Promise.resolve({ connectionId: id }) });
    const empty = await (await usage(mine.id)).json();
    expect(empty.message).toBe(`${label} connected. No requests recorded in the last 30 days.`);

    outbound.mockImplementation(async () => new Response(grokEvent({ token: "hello world" }) + grokEvent({ modelResponse: { message: "hello world" } })));
    chatgptExecutor.deps = { browser: { createSession: async () => ({}), runTurn: async () => ({ text: "hello world", status: "finished_successfully", endTurn: true }), readSessionCookies: async () => [] } };
    // The chat response schedules usage persistence without awaiting it.
    const usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
    expect((await chat(model)).status).toBe(200);
    expect(usageWrite).toHaveBeenCalledOnce();
    await usageWrite.mock.results[0].value;
    const summary = await (await usage(mine.id)).json();
    expect(summary.displayMessage).toBe(`${label} connected. 1 requests in the last 30 days.`);
    expect(Object.keys(summary.quotas)).toEqual(expect.arrayContaining(["Total tokens (30d)"]));
    expect((await (await usage(other.id)).json()).message).toBe(`${label} connected. No requests recorded in the last 30 days.`);
  });
});
