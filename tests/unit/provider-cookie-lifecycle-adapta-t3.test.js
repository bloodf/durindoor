/**
 * #2034: Adapta Web and T3 Chat Web saved-cookie lifecycle, offline.
 *
 * Real: sqlite DB, provider create/edit/validate/test routes, connection model
 * discovery, /v1/models, handleChat, account fallback, executors and the usage
 * route. Synthetic: every credential and every outbound byte (global fetch and
 * the proxy dispatcher seam). No live provider traffic, real session, browser or
 * Docker is involved.
 *
 * Source pins for the compared contracts are recorded in
 * internal/docs/adapta-t3-web-cookie-parity-2034.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const ADAPTA_CLERK = "https://clerk.agent.adapta.one";
const ADAPTA_CHAT = "https://agent.adapta.one/api/chat/stream/v1";
const T3_ROOT = "https://t3.chat/";
const T3_CHAT = "https://t3.chat/api/chat";

const ADAPTA_MODEL = "adp-web/adapta-one";
const T3_MODEL = "t3/claude-opus-4";

let root;
let db;
let routes;
let handleChat;
let seen;
let outbound;
let restoreFetch;
let proxyFetchSeam;

/** A short-lived Clerk JWT. Only the `exp` claim is read by the executor. */
const jwt = (name, ttlSeconds = 300) =>
  `eyJ.${Buffer.from(JSON.stringify({ name, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url")}.sig`;

const json = (url, body, method = "POST") =>
  new Request(`http://gateway.invalid${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });

async function addConnection(provider, name, apiKey, providerSpecificData, priority, extra) {
  const res = await routes.providers.POST(json("/api/providers", {
    provider, name, apiKey, providerSpecificData, priority, ...(extra || {}),
  }));
  expect(res.status).toBe(201);
  return (await res.json()).connection;
}

const chat = (model, extra = {}) =>
  handleChat(json("/v1/chat/completions", { model, messages: [{ role: "user", content: "hello" }], ...extra }));

const lockFields = (row) =>
  Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-lifecycle-adapta-t3-"));
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
    connectionModels: await import("../../src/app/api/providers/[id]/models/route.js"),
    models: await import("../../src/app/api/v1/models/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
    responses: await import("../../src/app/api/v1/responses/route.js"),
    usage: await import("../../src/app/api/usage/[connectionId]/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  // The proxy seam must come from the module instance the executors use, so it
  // is imported after the module registry reset rather than at file scope.
  proxyFetchSeam = await import("open-sse/utils/proxyFetch.js");
  // The setup builds a fresh sqlite database and imports ten route modules.
  // Under a loaded machine that can outlast Vitest's default 10 second hook
  // ceiling, so the hook carries the same explicit budget the other
  // database-backed suites in this package use.
}, 60_000);

afterEach(async () => {
  restoreFetch?.();
  restoreFetch = undefined;
  proxyFetchSeam?.__clearProxyDispatchersForTesting();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
}, 60_000);

/**
 * Closed mock of the Adapta Clerk + chat hops. `live` holds the `__client`
 * cookie values the mock still accepts; every other cookie is rejected the way
 * an expired Clerk session is.
 */
function adaptaTransport({ live = new Set(), text = "ok", chatStatus = 200 } = {}) {
  const issued = new Map();
  return async (url, init = {}) => {
    const target = String(url);
    const headers = new Headers(init.headers);
    seen.push({ url: target, cookie: headers.get("cookie"), authorization: headers.get("authorization") });
    if (target.includes("/tokens")) {
      const cookie = (headers.get("cookie") || "").replace(/^__client=/, "");
      const count = (issued.get(cookie) || 0) + 1;
      issued.set(cookie, count);
      return Response.json({ jwt: jwt(`${cookie}-${count}`) });
    }
    if (target === `${ADAPTA_CLERK}/v1/client`) {
      const cookie = (headers.get("cookie") || "").replace(/^__client=/, "");
      if (!live.has(cookie)) return new Response("private clerk diagnostic", { status: 401 });
      return Response.json({ response: { sessions: [{ id: `sess-${cookie}`, status: "active" }] } });
    }
    if (target !== ADAPTA_CHAT) throw new Error(`Unexpected fixture URL ${target}`);
    if (chatStatus !== 200) return new Response("private upstream diagnostic", { status: chatStatus });
    return new Response(
      `data: {"type":"text-delta","id":"quick-response","delta":"ignored"}\n\n` +
      `data: {"type":"text-delta","delta":"${text}"}\n\n` +
      `data: {"type":"done"}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
}

function t3Transport({ live = new Set(), text = "ok", chatStatus = 200, contentType = "application/json" } = {}) {
  return async (url, init = {}) => {
    const target = String(url);
    const headers = new Headers(init.headers);
    seen.push({ url: target, cookie: headers.get("cookie"), method: init.method });
    if (target === T3_ROOT) {
      const cookie = headers.get("cookie") || "";
      const id = /convex-session-id=([^;]+)/.exec(cookie)?.[1];
      if (!id || !live.has(id)) return new Response(null, { status: 403 });
      return new Response(null, { status: 200 });
    }
    if (target !== T3_CHAT) throw new Error(`Unexpected fixture URL ${target}`);
    if (chatStatus !== 200) return new Response("private upstream diagnostic", { status: chatStatus });
    // The chat hop enforces the same session as the read-only probe.
    const sessionId = /convex-session-id=([^;]+)/.exec(headers.get("cookie") || "")?.[1];
    if (!sessionId || !live.has(sessionId)) return new Response("private upstream diagnostic", { status: 401 });
    if (contentType === "application/x-ndjson") {
      return new Response(`{"text":"${text} "}\n{"t":10,"p":{"k":["content"],"v":[{"t":2,"s":"answer"}]}}\n{"done":true}`, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return Response.json({ choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] });
  };
}

describe("Adapta Web saved cookie lifecycle", () => {
  it("saves a session, skips the conversation probe, discovers the catalog and dispatches JSON and stream", async () => {
    const a = await addConnection("adapta-web", "adapta-a", "__client=synthetic-a", undefined, 1);
    const b = await addConnection("adapta-web", "adapta-b", "__client=synthetic-b", undefined, 2);
    expect(a).toMatchObject({ provider: "adapta-web", authType: "cookie" });
    expect(JSON.stringify([a, b])).not.toContain("synthetic-a");
    expect(a.id).not.toBe(b.id);

    // Adapta's chat endpoint creates a conversation per probe, so the automatic
    // probe must skip rather than fail, and must not touch the network.
    const validated = await (await routes.validate.POST(json("/api/providers/validate", { provider: "adapta-web", apiKey: "__client=synthetic-a" }))).json();
    expect(validated).toMatchObject({ skipped: true });
    const tested = await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id));
    expect((await tested.json()).skipped).toBe(true);
    expect(outbound).not.toHaveBeenCalled();

    // Discovery is the registry's curated catalog and sends no session.
    const discovered = await routes.connectionModels.GET(json(`/api/providers/${a.id}/models`, null, "GET"), params(a.id));
    expect(discovered.status).toBe(200);
    const catalog = await discovered.json();
    expect(catalog.source).toBe("local_catalog");
    expect(catalog.models.map((m) => m.id)).toEqual(expect.arrayContaining([
      "adapta-one", "adapta-gpt", "adapta-claude", "adapta-gemini", "adapta-grok", "adapta-deepseek", "adapta-llama",
    ]));
    expect(JSON.stringify(catalog)).not.toContain("synthetic-a");
    expect(outbound).not.toHaveBeenCalled();

    const ids = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([ADAPTA_MODEL, "adp-web/adapta-claude"]));

    outbound.mockImplementation(adaptaTransport({ live: new Set(["synthetic-a"]) }));
    const jsonRes = await chat(ADAPTA_MODEL);
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("ok");

    const streamRes = await chat(ADAPTA_MODEL, { stream: true });
    const streamText = await streamRes.text();
    expect(streamText).toContain('"content":"ok"');
    expect(streamText).toContain("[DONE]");
    // The "quick-response" placeholder is a loading event, not answer text.
    expect(streamText).not.toContain("ignored");

    // Clerk hops carry the cookie; the chat hop carries only the bearer token.
    const clerkCalls = seen.filter((call) => call.url.startsWith(ADAPTA_CLERK));
    const chatCalls = seen.filter((call) => call.url === ADAPTA_CHAT);
    expect(clerkCalls.length).toBeGreaterThan(0);
    expect(chatCalls.length).toBe(2);
    expect(clerkCalls.every((call) => call.cookie === "__client=synthetic-a" && !call.authorization)).toBe(true);
    expect(chatCalls.every((call) => !call.cookie && /^Bearer eyJ/.test(call.authorization || ""))).toBe(true);
  });

  it("keeps each saved account's Clerk session separate", async () => {
    await addConnection("adapta-web", "adapta-a", "__client=account-a", undefined, 1);
    await addConnection("adapta-web", "adapta-b", "__client=account-b", undefined, 2);
    outbound.mockImplementation(adaptaTransport({ live: new Set(["account-a", "account-b"]) }));

    await chat(ADAPTA_MODEL);
    const cookies = seen.filter((call) => call.url.startsWith(ADAPTA_CLERK)).map((call) => call.cookie);
    expect(cookies.length).toBeGreaterThan(0);
    expect(new Set(cookies).size).toBe(1);
    expect(cookies[0]).toBe("__client=account-a");
  });

  it("falls back from an expired session, keeps the sibling untouched, and recovers after re-paste", async () => {
    const expired = await addConnection("adapta-web", "expired", "__client=expired-session", undefined, 1);
    const live = await addConnection("adapta-web", "live", "__client=live-session", undefined, 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    outbound.mockImplementation(adaptaTransport({ live: new Set(["live-session"]) }));

    for (let i = 0; i < 3; i += 1) {
      const res = await chat(ADAPTA_MODEL);
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
    const put = await routes.provider.PUT(
      json(`/api/providers/${expired.id}`, { apiKey: "__client=fresh-session", testStatus: "unknown", lastError: null, lastErrorAt: null }, "PUT"),
      params(expired.id),
    );
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(expired.id);
    expect(reimported.apiKey).toBe("__client=fresh-session");
    expect(lockFields(reimported)).toEqual([]);

    seen.length = 0;
    outbound.mockImplementation(adaptaTransport({ live: new Set(["fresh-session"]) }));
    await db.updateProviderConnection(live.id, { isActive: false });
    const res = await chat(ADAPTA_MODEL);
    expect(res.status).toBe(200);
    expect(seen.filter((call) => call.url === `${ADAPTA_CLERK}/v1/client`).map((call) => call.cookie)).toEqual(["__client=fresh-session"]);
  });

  it("reports an actionable 401 when the only session is rejected, without leaking it", async () => {
    await addConnection("adapta-web", "only", "__client=expired-session");
    outbound.mockImplementation(adaptaTransport({ live: new Set() }));
    const res = await chat(ADAPTA_MODEL);
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/adapta/i);
    expect(text).not.toContain("expired-session");
    // The chat hop never runs without a session token.
    expect(seen.some((call) => call.url === ADAPTA_CHAT)).toBe(false);
  });

  it("keeps the pasted dashboard credential format compatible", async () => {
    const prefixed = await addConnection("adapta-web", "prefixed", "__client=prefixed-value", undefined, 1);
    outbound.mockImplementation(adaptaTransport({ live: new Set(["prefixed-value"]) }));
    expect((await chat(ADAPTA_MODEL)).status).toBe(200);
    expect(seen.filter((call) => call.url === `${ADAPTA_CLERK}/v1/client`).map((call) => call.cookie)).toEqual(["__client=prefixed-value"]);

    // A pasted value without the cookie name is the raw session value.
    await addConnection("adapta-web", "bare", "bare-value", undefined, 2);
    await db.updateProviderConnection(prefixed.id, { isActive: false });
    seen.length = 0;
    outbound.mockImplementation(adaptaTransport({ live: new Set(["bare-value"]) }));
    expect((await chat(ADAPTA_MODEL)).status).toBe(200);
    expect(seen.filter((call) => call.url === `${ADAPTA_CLERK}/v1/client`).map((call) => call.cookie)).toEqual(["__client=bare-value"]);
  });
});

describe("T3 Chat Web saved cookie lifecycle", () => {
  const COOKIE = "sessionToken=synthetic-t3; convex-session-id=sess-t3";
  const PAIR = "cookies=sessionToken=synthetic-t3\nconvexSessionId=sess-t3";

  it("saves a cookie, validates it read-only, discovers the local catalog and dispatches JSON and stream", async () => {
    const a = await addConnection("t3-web", "t3-a", COOKIE, undefined, 1);
    const b = await addConnection("t3-web", "t3-b", PAIR, undefined, 2);
    expect(a).toMatchObject({ provider: "t3-web", authType: "cookie" });
    expect(JSON.stringify([a, b])).not.toContain("synthetic-t3");
    expect(a.id).not.toBe(b.id);

    outbound.mockImplementation(t3Transport({ live: new Set(["sess-t3"]) }));
    const validated = await (await routes.validate.POST(json("/api/providers/validate", { provider: "t3-web", apiKey: COOKIE }))).json();
    expect(validated).toMatchObject({ valid: true });
    const tested = await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id));
    expect((await tested.json()).valid).toBe(true);
    // The validation probe is read-only: it never opens a chat.
    expect(seen.every((call) => call.url === T3_ROOT)).toBe(true);

    const discovered = await routes.connectionModels.GET(json(`/api/providers/${a.id}/models`, null, "GET"), params(a.id));
    expect(discovered.status).toBe(200);
    const catalog = await discovered.json();
    expect(catalog.source).toBe("local_catalog");
    expect(catalog.models.map((m) => m.id)).toEqual(expect.arrayContaining(["claude-opus-4", "gpt-5", "gemini-2.5-pro"]));
    expect(JSON.stringify(catalog)).not.toContain("synthetic-t3");

    const ids = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([T3_MODEL, "t3/gpt-5"]));

    seen.length = 0;
    const jsonRes = await chat(T3_MODEL);
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("ok");

    const streamRes = await chat(T3_MODEL, { stream: true });
    const streamText = await streamRes.text();
    expect(streamText).toContain('"content":"ok"');
    expect(streamText).toContain("[DONE]");

    // The session reaches t3.chat and nowhere else.
    expect(seen.every((call) => call.url.startsWith("https://t3.chat/"))).toBe(true);
    expect(seen.filter((call) => call.url === T3_CHAT).every((call) => call.cookie)).toBe(true);
  });

  it("adapts the provider's typed newline-delimited events to OpenAI output", async () => {
    await addConnection("t3-web", "t3-ndjson", COOKIE);
    outbound.mockImplementation(t3Transport({ live: new Set(["sess-t3"]), contentType: "application/x-ndjson" }));

    const jsonRes = await chat(T3_MODEL);
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("ok answer");

    const streamText = await (await chat(T3_MODEL, { stream: true })).text();
    expect(streamText).toContain('"content":"ok "');
    expect(streamText).toContain('"content":"answer"');
    expect(streamText).toContain("[DONE]");
  });

  it("rejects a pasted cookie without convex-session-id locally, without contacting t3.chat", async () => {
    await addConnection("t3-web", "no-session", "sessionToken=synthetic-t3");
    const res = await chat(T3_MODEL);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/convex-session-id/i);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("falls back from a rejected session, keeps the sibling untouched, and recovers after re-paste", async () => {
    const expired = await addConnection("t3-web", "expired", "convex-session-id=expired-session; sessionToken=t", undefined, 1);
    const live = await addConnection("t3-web", "live", "convex-session-id=live-session; sessionToken=t", undefined, 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    outbound.mockImplementation(t3Transport({ live: new Set(["live-session"]) }));

    for (let i = 0; i < 3; i += 1) {
      const res = await chat(T3_MODEL);
      expect(res.status).toBe(200);
      expect((await res.json()).choices[0].message.content).toBe("ok");
    }
    const after = await db.getProviderConnectionById(expired.id);
    expect(after.errorCode ?? after.lastErrorCode).toBeTruthy();
    expect(lockFields(after).length).toBeGreaterThan(0);
    expect(JSON.stringify(after.lastError ?? "")).not.toContain("expired-session");
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    const put = await routes.provider.PUT(
      json(`/api/providers/${expired.id}`, { apiKey: "convex-session-id=fresh-session; sessionToken=t", testStatus: "unknown", lastError: null, lastErrorAt: null }, "PUT"),
      params(expired.id),
    );
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(expired.id);
    expect(reimported.apiKey).toBe("convex-session-id=fresh-session; sessionToken=t");
    expect(lockFields(reimported)).toEqual([]);

    seen.length = 0;
    outbound.mockImplementation(t3Transport({ live: new Set(["fresh-session"]) }));
    await db.updateProviderConnection(live.id, { isActive: false });
    const res = await chat(T3_MODEL);
    expect(res.status).toBe(200);
    expect(seen.filter((call) => call.url === T3_CHAT).map((call) => call.cookie)).toEqual(["convex-session-id=fresh-session; sessionToken=t"]);
  });

  it("reports an actionable 401 when the only session is rejected", async () => {
    await addConnection("t3-web", "only", "convex-session-id=expired-session; sessionToken=t");
    outbound.mockImplementation(t3Transport({ chatStatus: 401 }));
    const res = await chat(T3_MODEL);
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/t3 chat/i);
    expect(text).not.toContain("expired-session");
  });
});

describe("web cookie usage reporting", () => {
  it.each([
    ["adapta-web", ADAPTA_MODEL, "Adapta Web"],
    ["t3-web", T3_MODEL, "T3 Chat Web"],
  ])("summarises only DurinDoor's own recorded requests for a saved %s session", async (provider, model, label) => {
    const credential = provider === "adapta-web" ? "__client=mine" : "convex-session-id=mine; sessionToken=t";
    const mine = await addConnection(provider, "mine", credential, undefined, 1);
    const other = await addConnection(provider, "other", credential, undefined, 2);
    const usage = (id) => routes.usage.GET(json(`/api/usage/${id}`, null, "GET"), { params: Promise.resolve({ connectionId: id }) });

    const empty = await (await usage(mine.id)).json();
    expect(empty.message).toBe(`${label} connected. No requests recorded in the last 30 days.`);

    outbound.mockImplementation(provider === "adapta-web"
      ? adaptaTransport({ live: new Set(["mine"]), text: "hello world" })
      : t3Transport({ live: new Set(["mine"]), text: "hello world" }));
    // The chat response schedules usage persistence without awaiting it.
    const usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
    expect((await chat(model)).status).toBe(200);
    expect(usageWrite).toHaveBeenCalledOnce();
    await usageWrite.mock.results[0].value;
    {
      const summary = await (await usage(mine.id)).json();
      expect(summary.displayMessage).toBe(`${label} connected. 1 requests in the last 30 days.`);
    }
    const summary = await (await usage(mine.id)).json();
    expect(Object.keys(summary.quotas)).toEqual(expect.arrayContaining(["Total tokens (30d)"]));
    // The provider reports no token counts, so the card carries the estimate
    // the other web-cookie transports use (about four characters per token).
    expect(summary.quotas["Total tokens (30d)"].used).toBeGreaterThan(0);
    expect((await (await usage(other.id)).json()).message).toBe(`${label} connected. No requests recorded in the last 30 days.`);
  });
});

describe("gateway entry points", () => {
  it("serves Anthropic Messages and OpenAI Responses clients from the same saved Adapta session", async () => {
    await addConnection("adapta-web", "adapta-a", "__client=synthetic-a");
    outbound.mockImplementation(adaptaTransport({ live: new Set(["synthetic-a"]), text: "pong" }));
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));

    const message = await post("messages", { model: ADAPTA_MODEL, max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content[0].text).toBe("pong");
    const messageStream = await (await post("messages", { model: ADAPTA_MODEL, max_tokens: 16, stream: true, messages: [{ role: "user", content: "ping" }] })).text();
    expect(messageStream).toContain("event: message_start");
    expect(messageStream).toContain("event: message_stop");

    const response = await post("responses", { model: ADAPTA_MODEL, input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("pong");
    const responseStream = await (await post("responses", { model: ADAPTA_MODEL, input: "ping", stream: true })).text();
    expect(responseStream).toContain("response.completed");
  });

  it("serves Anthropic Messages and OpenAI Responses clients from the same saved T3 session", async () => {
    await addConnection("t3-web", "t3-a", "convex-session-id=sess-t3; sessionToken=t");
    outbound.mockImplementation(t3Transport({ live: new Set(["sess-t3"]), text: "pong" }));
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));

    const message = await post("messages", { model: T3_MODEL, max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content[0].text).toBe("pong");
    const messageStream = await (await post("messages", { model: T3_MODEL, max_tokens: 16, stream: true, messages: [{ role: "user", content: "ping" }] })).text();
    expect(messageStream).toContain("event: message_start");
    expect(messageStream).toContain("event: message_stop");

    const response = await post("responses", { model: T3_MODEL, input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("pong");
    const responseStream = await (await post("responses", { model: T3_MODEL, input: "ping", stream: true })).text();
    expect(responseStream).toContain("response.completed");
  });
});

describe("proxy egress", () => {
  const PROXY_URL = "http://proxy.invalid:8080";

  it("routes every Adapta hop through the connection proxy", async () => {
    const dispatcher = {};
    proxyFetchSeam.__setProxyDispatcherForTesting(PROXY_URL, dispatcher);
    const transport = vi.fn(async (url, init, route) => {
      const headers = new Headers(init.headers);
      seen.push({ url: String(url), route, cookie: headers.get("cookie"), authorization: headers.get("authorization") });
      const target = String(url);
      if (target.includes("/tokens")) return Response.json({ jwt: jwt("proxied") });
      if (target === `${ADAPTA_CLERK}/v1/client`) return Response.json({ response: { sessions: [{ id: "proxied", status: "active" }] } });
      return new Response('data: {"type":"text-delta","delta":"ok"}\n\ndata: {"type":"done"}\n\n');
    });
    restoreFetch = proxyFetchSeam.__setOriginalFetchForTesting(async (url, init) =>
      transport(url, init, init.dispatcher === dispatcher ? "proxy" : "direct"));

    await addConnection("adapta-web", "proxied", "__client=proxied-value", undefined, 1, {
      connectionProxyEnabled: true,
      connectionProxyUrl: PROXY_URL,
    });
    const res = await chat(ADAPTA_MODEL);
    expect(res.status).toBe(200);
    // Clerk lookup, Clerk token exchange and the chat hop all use the proxy.
    expect(seen.map((call) => call.route)).toEqual(["proxy", "proxy", "proxy"]);
    expect(seen.map((call) => new URL(call.url).host)).toEqual([
      "clerk.agent.adapta.one", "clerk.agent.adapta.one", "agent.adapta.one",
    ]);
    // The cookie never leaves the Clerk hops and the bearer never reaches them.
    expect(seen[0].cookie).toBe("__client=proxied-value");
    expect(seen[0].authorization).toBeNull();
    expect(seen[1].cookie).toBe("__client=proxied-value");
    expect(seen[1].authorization).toBeNull();
    expect(seen[2].cookie).toBeNull();
    expect(seen[2].authorization).toMatch(/^Bearer eyJ/);
  });

  it("refuses an HTTP relay for a T3 Chat session, without sending the session", async () => {
    const pool = await db.createProxyPool({
      name: "relay-pool", type: "vercel", proxyUrl: "https://relay.invalid/forward", isActive: true,
    });
    const connection = await addConnection("t3-web", "relayed", "convex-session-id=sess-t3; sessionToken=t", undefined, 1, {
      proxyPoolId: pool.id,
    });

    const res = await chat(T3_MODEL);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/relay/i);
    expect(outbound).not.toHaveBeenCalled();

    const tested = await routes.test.POST(json(`/api/providers/${connection.id}/test`, {}), params(connection.id));
    expect((await tested.json()).error).toMatch(/relay/i);
    expect(outbound).not.toHaveBeenCalled();
  });
});
