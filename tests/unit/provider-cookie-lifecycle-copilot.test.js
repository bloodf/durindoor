/**
 * Cookie lifecycle for Copilot Web (`copilot-web`) and Microsoft 365 Copilot
 * Web (`copilot-m365-web`), #2034.
 *
 * Everything here is closed: a temporary DATA_DIR, synthetic credentials, a
 * fake fetch and a fake WebSocket. No provider is contacted. The flow follows
 * the dashboard: save a cookie connection, validate it, list models, dispatch
 * through the gateway chat handler (JSON and SSE), then exercise expiry,
 * account fallback and reimport.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let api;

/** Unsigned JWT-shaped token; only the `exp` claim matters to the code under test. */
const jwt = (exp) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.synthetic`;
const future = () => jwt(Math.floor(Date.now() / 1000) + 3600);
const past = () => jwt(Math.floor(Date.now() / 1000) - 3600);

const m365Cookie = (token, user = "user-oid", tenant = "tenant-id") => `access_token=${token}; chathubPath=${user}@${tenant}`;

/** Fake `ws` socket shared by both executors; behaviour is picked per test through `script`. */
const sockets = [];
let script;
class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.handlers = {};
    sockets.push(this);
    queueMicrotask(() => (script.open ? script.open(this) : this.emit("open")));
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, value) { this.handlers[name]?.(value); }
  close() {}
  send(data) {
    const text = String(data).replace(/\x1e$/, "");
    let frame;
    try { frame = JSON.parse(text); } catch { return; }
    script.onFrame?.(this, frame);
  }
}
/** Personal Copilot protocol: answer `send` with text then `done`. */
const copilotReply = (...chunks) => (socket, frame) => {
  if (frame.event !== "send") return;
  queueMicrotask(() => {
    for (const text of chunks) socket.emit("message", JSON.stringify({ event: "appendText", text }));
    socket.emit("message", JSON.stringify({ event: "done" }));
  });
};
/** M365 Chathub protocol: handshake, then bot text snapshots, then completion. */
const m365Reply = (...snapshots) => (socket, frame) => {
  if (frame.protocol) queueMicrotask(() => socket.emit("message", Buffer.from("{}\x1e")));
  if (frame.target === "chat") {
    queueMicrotask(() => {
      const updates = snapshots.map((text) => JSON.stringify({ type: 1, target: "update", arguments: [{ messages: [{ author: "bot", text }] }] }));
      socket.emit("message", Buffer.from(`${updates.join("\x1e")}\x1e{"type":3}\x1e`));
    });
  }
};

/** Fake `/c/api/start`; records the bearer used so account boundaries can be asserted. */
const startCalls = [];
let startHandler;
const fakeFetch = vi.fn(async (url, init = {}) => {
  startCalls.push({ url: String(url), authorization: init.headers?.Authorization });
  return startHandler(String(url), init);
});
const startOk = (conversationId = "synthetic-conversation") => new Response(JSON.stringify({ currentConversationId: conversationId }), { status: 200 });

const json = (url, method, body) => new Request(`https://durindoor.local${url}`, {
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const chat = (model, extra = {}) => api.handleChat(json("/v1/chat/completions", "POST", {
  model,
  messages: [{ role: "user", content: "hello" }],
  ...extra,
}));

async function save(provider, apiKey, name, extra = {}) {
  const res = await api.POST(json("/api/providers", "POST", { provider, apiKey, name, ...extra }));
  return { status: res.status, body: await res.json() };
}
async function reimport(id, apiKey) {
  const res = await api.PUT(json(`/api/providers/${id}`, "PUT", { apiKey }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}
async function clearConnections() {
  for (const connection of await api.getProviderConnections()) await api.deleteProviderConnection(connection.id);
}
async function validate(provider, apiKey, providerSpecificData) {
  const res = await api.validate(json("/api/providers/validate", "POST", { provider, apiKey, providerSpecificData }));
  return res.json();
}
const sseText = async (res) => res.text();
const stored = (id) => api.getProviderConnectionById(id);

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-copilot-lifecycle-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { "Content-Type": "application/json" } }),
    },
  }));
  const models = await import("@/models/index.js");
  const dbIndex = await import("@/lib/db/index.js");
  await dbIndex.initDb();
  const web = await import("../../open-sse/executors/copilot-web.js");
  const m365 = await import("../../open-sse/executors/copilot-m365-web.js");
  const proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  api = {
    ...models,
    POST: (await import("@/app/api/providers/route.js")).POST,
    PUT: (await import("@/app/api/providers/[id]/route.js")).PUT,
    validate: (await import("@/app/api/providers/validate/route.js")).POST,
    getConnectionModels: (await import("@/app/api/providers/[id]/models/route.js")).GET,
    testSingleConnection: (await import("../../src/app/api/providers/[id]/test/testUtils.js")).testSingleConnection,
    buildModelsList: (await import("../../src/app/api/v1/models/buildModelsList.js")),
    handleChat: (await import("../../src/sse/handlers/chat.js")).handleChat,
    restores: [
      proxyFetch.__setOriginalFetchForTesting(fakeFetch),
      web.__setCopilotWebSocketForTesting(FakeSocket),
      m365.__setCopilotM365WebSocketForTesting(FakeSocket),
    ],
  };
}, 90_000);

afterAll(async () => {
  api?.restores?.forEach((restore) => restore());
  vi.doUnmock("next/server");
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  await clearConnections();
  sockets.length = 0;
  startCalls.length = 0;
  fakeFetch.mockClear();
  script = { onFrame: copilotReply("hi") };
  startHandler = () => startOk();
});


describe("Copilot Web (copilot-web) cookie lifecycle", () => {
  const MODEL = "copilot-web/copilot-pro";

  it("saves each credential format verbatim as a cookie connection and never echoes the secret", async () => {
    const har = JSON.stringify({ log: { entries: [{ request: { url: "https://copilot.microsoft.com/c/api/start", headers: [{ name: "Cookie", value: "access_token=har-token" }] } }] } });
    const formats = {
      bare: "bare-token",
      cookieHeader: "theme=dark; access_token=cookie-token",
      bearer: "Bearer bearer-token",
      structured: '{"access_token":"json-token","origin":"https://copilot.microsoft.com"}',
      har,
    };
    for (const [name, value] of Object.entries(formats)) {
      const created = await save("copilot-web", value, name);
      expect(created.status).toBe(201);
      expect(created.body.connection.authType).toBe("cookie");
      expect(JSON.stringify(created.body)).not.toContain(value);
      expect((await stored(created.body.connection.id)).apiKey).toBe(value);
    }
    // Cookie rows are not name-keyed: a second paste is a separate account row.
    const again = await save("copilot-web", "bare-token-2", "bare");
    expect(again.status).toBe(201);
    expect((await api.getProviderConnections()).filter((c) => c.provider === "copilot-web")).toHaveLength(Object.keys(formats).length + 1);
    expect((await save("copilot-web", "", "empty")).status).toBe(400);
  });

  it("validates locally without a conversation request and reports an expired token", async () => {
    expect(await validate("copilot-web", "opaque-token")).toMatchObject({ valid: false, skipped: true });
    expect(await validate("copilot-web", future())).toMatchObject({ valid: false, skipped: true });
    const expired = await validate("copilot-web", past());
    expect(expired.valid).toBe(false);
    expect(expired.skipped).toBeUndefined();
    expect(expired.error).toContain("expired");

    const saved = await save("copilot-web", past(), "expired");
    const tested = await api.testSingleConnection(saved.body.connection.id);
    expect(tested).toMatchObject({ valid: false });
    expect(tested.skipped).toBeUndefined();
    expect(tested.error).toContain("expired");
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });

  it("publishes a static catalog: no per-connection discovery, models appear once a connection exists", async () => {
    const list = async () => (await api.buildModelsList.buildModelsList([api.buildModelsList.LLM_KIND])).map((m) => m.id);
    const before = await list();
    expect(before.some((id) => id.startsWith("copilot/"))).toBe(false);
    const catalog = await save("copilot-web", "catalog-token", "catalog");
    const perConnection = await api.getConnectionModels(
      new Request("https://durindoor.local/api/providers/x/models"),
      { params: Promise.resolve({ id: catalog.body.connection.id }) },
    );
    expect(perConnection.status).toBe(400);
    expect((await perConnection.json()).error).toContain("does not support models listing");
    const after = await list();
    expect(after).toEqual(expect.arrayContaining(["copilot/copilot-pro", "copilot/gpt-4-turbo", "copilot/gpt-4"]));
    expect(after.some((id) => id.startsWith("m365/"))).toBe(false);
    expect(startCalls.filter((call) => /microsoft|office/.test(call.url))).toEqual([]);
    expect(sockets).toHaveLength(0);
  });

  it("dispatches JSON through the gateway with the saved bearer and a fresh conversation", async () => {
    script = { onFrame: copilotReply("hel", "lo") };
    await save("copilot-web", "json-token", "json");
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe("hello");
    expect(body.usage.total_tokens).toBeGreaterThan(0);
    expect(startCalls).toEqual([{ url: "https://copilot.microsoft.com/c/api/start", authorization: "Bearer json-token" }]);
    expect(sockets[0].options.headers.Authorization).toBe("Bearer json-token");
    expect(sockets[0].url).not.toContain("json-token");
  });

  it("streams SSE through the gateway and ends with a stop chunk and [DONE]", async () => {
    script = { onFrame: copilotReply("str", "eam") };
    await save("copilot-web", "stream-token", "stream");
    const res = await chat(MODEL, { stream: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await sseText(res);
    expect(text).toContain('"content":"str"');
    expect(text).toContain('"content":"eam"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("rejects an unusable paste at dispatch without any outbound request", async () => {
    await save("copilot-web", "sso=unrelated; theme=dark", "unrelated");
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });

  it("refuses an expired JWT locally (401) and flags the connection", async () => {
    const saved = await save("copilot-web", past(), "expired");
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).toContain("expired");
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
    expect(await stored(saved.body.connection.id)).toMatchObject({ testStatus: "unavailable", errorCode: 401 });
  });

  it("falls back to the next account when a token is rejected and never reuses the rejected token", async () => {
    startHandler = (_url, init) => (init.headers.Authorization === "Bearer stale-token" ? new Response("expired", { status: 401 }) : startOk());
    script = { onFrame: copilotReply("from-b") };
    const a = await save("copilot-web", "stale-token", "a", { priority: 1 });
    await save("copilot-web", "fresh-token", "b", { priority: 2 });
    const first = await chat(MODEL, { stream: false });
    expect(first.status).toBe(200);
    expect((await first.json()).choices[0].message.content).toBe("from-b");
    expect(startCalls.map((c) => c.authorization)).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].options.headers.Authorization).toBe("Bearer fresh-token");
    expect(await stored(a.body.connection.id)).toMatchObject({ testStatus: "unavailable", errorCode: 401 });

    startCalls.length = 0;
    expect((await chat(MODEL, { stream: false })).status).toBe(200);
    expect(startCalls.map((c) => c.authorization)).toEqual(["Bearer fresh-token"]);
  });

  it("maps a rejected WebSocket upgrade to 401 so the next account serves the request", async () => {
    const stale = await save("copilot-web", "ws-stale", "a", { priority: 1 });
    await save("copilot-web", "ws-fresh", "b", { priority: 2 });
    script = {
      open: (socket) => (socket.options.headers.Authorization === "Bearer ws-stale"
        ? socket.emit("error", new Error("Unexpected server response: 401"))
        : socket.emit("open")),
      onFrame: copilotReply("ok-b"),
    };
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("ok-b");
    expect(sockets.map((s) => s.options.headers.Authorization)).toEqual(["Bearer ws-stale", "Bearer ws-fresh"]);
    // Flagged as an auth failure (401), not a transient 502.
    expect(await stored(stale.body.connection.id)).toMatchObject({ testStatus: "unavailable", errorCode: 401 });
  });

  it("recovers after reimport: a replaced token is used and the old one is never sent again", async () => {
    startHandler = (_url, init) => (init.headers.Authorization === "Bearer old-token" ? new Response("expired", { status: 401 }) : startOk());
    const saved = await save("copilot-web", "old-token", "only");
    const id = saved.body.connection.id;
    expect((await chat(MODEL, { stream: false })).status).toBe(401);
    startCalls.length = 0;

    const updated = await reimport(id, "new-token");
    expect(updated.status).toBe(200);
    const reimported = await stored(id);
    expect(reimported.apiKey).toBe("new-token");
    expect(reimported).toMatchObject({ testStatus: "unknown", errorCode: null, lastError: null });
    expect(Object.keys(reimported).filter((key) => key.startsWith("modelLock_") && reimported[key])).toEqual([]);
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(200);
    expect(startCalls.map((c) => c.authorization)).toEqual(["Bearer new-token"]);
  });
});

describe("Microsoft 365 Copilot Web (copilot-m365-web) cookie lifecycle", () => {
  const MODEL = "m365copilot/copilot-m365";
  const chathub = (token, path = "user-oid@tenant-id") => `wss://substrate.office.com/m365Copilot/Chathub/${encodeURIComponent(path)}?access_token=${token}&source=officeweb`;

  it("saves the dashboard cookie format verbatim, also accepts a pasted Chathub URL, and keeps a separate row per account", async () => {
    const formats = {
      pair: m365Cookie("pair-token"),
      url: chathub("url-token"),
      tenantAlias: "access_token=alias-token; userTenant=user-oid@tenant-id",
    };
    for (const [name, value] of Object.entries(formats)) {
      const created = await save("copilot-m365-web", value, name);
      expect(created.status).toBe(201);
      expect(created.body.connection).toMatchObject({ provider: "copilot-m365-web", authType: "cookie" });
      expect(JSON.stringify(created.body)).not.toContain(value);
      expect((await stored(created.body.connection.id)).apiKey).toBe(value);
    }
    const personal = await save("copilot-web", "personal-token", "personal");
    expect((await stored(personal.body.connection.id)).provider).toBe("copilot-web");
    expect(await api.getProviderConnections()).toHaveLength(4);
  });

  it("imports a HAR: the newest Chathub socket on the allowed host wins, foreign and redacted entries are ignored", async () => {
    const entry = (url) => ({ request: { url, headers: [] } });
    const har = JSON.stringify({ log: { entries: [
      entry(chathub("har-old", "oid-old@tenant-old")),
      entry(chathub("foreign-token", "oid-x@tenant-x").replace("substrate.office.com", "attacker.example")),
      entry(chathub("REDACTED", "oid-r@tenant-r")),
      entry("https://m365.cloud.microsoft/chat"),
      entry(chathub("har-new", "oid-new@tenant-new")),
    ] } });
    expect(await validate("copilot-m365-web", har)).toMatchObject({ valid: true });
    const foreignOnly = JSON.stringify({ log: { entries: [entry(chathub("foreign-token").replace("substrate.office.com", "attacker.example"))] } });
    expect((await validate("copilot-m365-web", foreignOnly)).valid).toBe(false);
    expect((await validate("copilot-m365-web", JSON.stringify({ log: { entries: [entry(chathub("har-token"))] } }), { chathubPath: "user@tenant" })).valid).toBe(true);
    expect((await validate("copilot-m365-web", JSON.stringify({ log: { entries: [] } }), { chathubPath: "user@tenant" })).valid).toBe(false);

    script = { onFrame: m365Reply("har") };
    const saved = await save("copilot-m365-web", har, "har");
    expect(saved.status).toBe(201);
    expect((await stored(saved.body.connection.id)).apiKey).toBe(har);
    expect((await chat(MODEL, { stream: false })).status).toBe(200);
    const url = new URL(sockets[0].url);
    expect(url.searchParams.get("access_token")).toBe("har-new");
    expect(decodeURIComponent(url.pathname)).toBe("/m365Copilot/Chathub/oid-new@tenant-new");
    expect(sockets[0].url).not.toContain("foreign-token");
    expect(sockets[0].url).not.toContain("har-old");
  });

  it("validates locally: shape, host, expiry; never opens a socket or fetches", async () => {
    expect(await validate("copilot-m365-web", m365Cookie("tok"))).toMatchObject({ valid: true, error: null });
    expect(await validate("copilot-m365-web", chathub("tok"))).toMatchObject({ valid: true });
    expect((await validate("copilot-m365-web", "access_token=tok")).valid).toBe(false);
    expect((await validate("copilot-m365-web", "chathubPath=user@tenant")).valid).toBe(false);
    expect((await validate("copilot-m365-web", "access_token=[REDACTED]; chathubPath=user@tenant")).valid).toBe(false);
    expect((await validate("copilot-m365-web", m365Cookie("tok"), { host: "attacker.example" })).valid).toBe(false);
    expect(await validate("copilot-m365-web", m365Cookie(future()))).toMatchObject({ valid: true });
    const expired = await validate("copilot-m365-web", m365Cookie(past()));
    expect(expired.valid).toBe(false);
    expect(expired.error).toContain("expired");

    const good = await save("copilot-m365-web", m365Cookie("saved-token"), "good");
    const stale = await save("copilot-m365-web", m365Cookie(past()), "stale");
    expect(await api.testSingleConnection(good.body.connection.id)).toMatchObject({ valid: true });
    const staleResult = await api.testSingleConnection(stale.body.connection.id);
    expect(staleResult.valid).toBe(false);
    expect(staleResult.error).toContain("expired");
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });

  it("publishes a static catalog under the m365 alias once a connection exists", async () => {
    await save("copilot-m365-web", m365Cookie("catalog-token"), "catalog");
    const ids = (await api.buildModelsList.buildModelsList([api.buildModelsList.LLM_KIND])).map((m) => m.id);
    expect(ids).toContain("m365/copilot-m365");
    expect(ids.some((id) => id.startsWith("copilot/"))).toBe(false);
  });

  it("dispatches JSON through the gateway, scoping the token and tenant path to the Chathub socket", async () => {
    script = { onFrame: m365Reply("hello ", "hello world") };
    await save("copilot-m365-web", m365Cookie("m365-json", "oid-1", "tenant-1"), "json");
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("hello world");
    expect(fakeFetch).not.toHaveBeenCalled();
    const url = new URL(sockets[0].url);
    expect(url.hostname).toBe("substrate.office.com");
    expect(decodeURIComponent(url.pathname)).toBe("/m365Copilot/Chathub/oid-1@tenant-1");
    expect(url.searchParams.get("access_token")).toBe("m365-json");
    expect(url.searchParams.get("agent")).toBe("web");
  });

  it("streams SSE deltas and finishes with stop and [DONE]", async () => {
    script = { onFrame: m365Reply("str", "stream") };
    await save("copilot-m365-web", m365Cookie("m365-stream"), "stream");
    const res = await chat(MODEL, { stream: true });
    expect(res.status).toBe(200);
    const text = await sseText(res);
    expect(text).toContain('"content":"str"');
    expect(text).toContain('"content":"eam"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("selects the work profile only for a connection that opts in", async () => {
    script = { onFrame: m365Reply("ok") };
    await save("copilot-m365-web", m365Cookie("work-token", "work-oid", "work-tenant"), "work", { providerSpecificData: { tier: "work" } });
    expect((await chat(MODEL, { stream: false })).status).toBe(200);
    const url = new URL(sockets[0].url);
    expect(url.searchParams.get("agent")).toBe("work");
    expect(url.searchParams.get("licenseType")).toBe("Premium");
  });

  it("refuses an expired JWT locally (401) without opening a socket", async () => {
    const saved = await save("copilot-m365-web", m365Cookie(past()), "expired");
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).toContain("expired");
    expect(sockets).toHaveLength(0);
    expect(await stored(saved.body.connection.id)).toMatchObject({ testStatus: "unavailable", errorCode: 401 });
  });

  it("rejects a connection saved without a usable Chathub path at dispatch (400) and does not retry elsewhere", async () => {
    await save("copilot-m365-web", "access_token=only-a-token", "missing-path");
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Chathub path");
    expect(sockets).toHaveLength(0);
  });

  it("maps a rejected WebSocket upgrade to 401 and serves the request from the next tenant", async () => {
    script = {
      open: (socket) => (new URL(socket.url).searchParams.get("access_token") === "m365-stale"
        ? socket.emit("error", new Error("Unexpected server response: 401"))
        : socket.emit("open")),
      onFrame: m365Reply("from-b"),
    };
    const a = await save("copilot-m365-web", m365Cookie("m365-stale", "oid-a", "tenant-a"), "a", { priority: 1 });
    await save("copilot-m365-web", m365Cookie("m365-fresh", "oid-b", "tenant-b"), "b", { priority: 2 });
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("from-b");
    const used = sockets.map((s) => decodeURIComponent(new URL(s.url).pathname).split("/").pop());
    expect(used).toEqual(["oid-a@tenant-a", "oid-b@tenant-b"]);
    expect(await stored(a.body.connection.id)).toMatchObject({ testStatus: "unavailable", errorCode: 401 });
  });

  it("reports a rewritten stream snapshot as an error and returns the final snapshot without streaming", async () => {
    script = { onFrame: m365Reply("old answer", "new answer") };
    await save("copilot-m365-web", m365Cookie("rewrite-token"), "rewrite");
    const streamed = await sseText(await chat(MODEL, { stream: true }));
    expect(streamed).toContain("rewrote");
    expect(streamed).not.toContain('"content":"new answer"');
    const buffered = await chat(MODEL, { stream: false });
    expect((await buffered.json()).choices[0].message.content).toBe("new answer");
  });

  it("recovers after reimport and keeps the token out of logged URLs", async () => {
    script = {
      open: (socket) => (new URL(socket.url).searchParams.get("access_token") === "m365-old"
        ? socket.emit("error", new Error("Unexpected server response: 401"))
        : socket.emit("open")),
      onFrame: m365Reply("back"),
    };
    const saved = await save("copilot-m365-web", m365Cookie("m365-old"), "only");
    const id = saved.body.connection.id;
    expect((await chat(MODEL, { stream: false })).status).toBe(401);
    sockets.length = 0;

    expect((await reimport(id, m365Cookie("m365-new"))).status).toBe(200);
    expect((await stored(id)).apiKey).toBe(m365Cookie("m365-new"));
    const res = await chat(MODEL, { stream: false });
    expect(res.status).toBe(200);
    expect(sockets.map((s) => new URL(s.url).searchParams.get("access_token"))).toEqual(["m365-new"]);

    const { CopilotM365WebExecutor } = await import("../../open-sse/executors/copilot-m365-web.js");
    const direct = await new CopilotM365WebExecutor().execute({
      body: { messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: m365Cookie("m365-secret") },
      stream: false,
    });
    expect(direct.url).toContain("access_token=REDACTED");
    expect(direct.url).not.toContain("m365-secret");
  });
});

describe("account and provider boundaries", () => {
  it("never sends one provider's credential through the other provider's transport", async () => {
    script = { onFrame: (socket, frame) => (frame.protocol || frame.target === "chat" ? m365Reply("m365")(socket, frame) : copilotReply("personal")(socket, frame)) };
    await save("copilot-web", "personal-secret", "personal");
    await save("copilot-m365-web", m365Cookie("tenant-secret", "oid", "tenant"), "tenant");

    expect((await chat("copilot-web/copilot-pro", { stream: false })).status).toBe(200);
    expect((await chat("m365copilot/copilot-m365", { stream: false })).status).toBe(200);

    expect(startCalls).toEqual([{ url: "https://copilot.microsoft.com/c/api/start", authorization: "Bearer personal-secret" }]);
    const [personalSocket, tenantSocket] = sockets;
    expect(personalSocket.url).toContain("copilot.microsoft.com");
    expect(personalSocket.url).not.toContain("tenant-secret");
    expect(personalSocket.options.headers.Authorization).toBe("Bearer personal-secret");
    expect(tenantSocket.url).toContain("substrate.office.com");
    expect(tenantSocket.url).not.toContain("personal-secret");
    expect(tenantSocket.options.headers.Authorization).toBeUndefined();
  });

  it("does not serve a Microsoft 365 model from a personal connection (and vice versa)", async () => {
    await save("copilot-web", "only-personal", "personal");
    const m365 = await chat("m365copilot/copilot-m365", { stream: false });
    expect(m365.status).toBeGreaterThanOrEqual(400);
    expect(sockets).toHaveLength(0);
    expect(startCalls).toEqual([]);

    await clearConnections();
    await save("copilot-m365-web", m365Cookie("only-tenant"), "tenant");
    const personal = await chat("copilot-web/copilot-pro", { stream: false });
    expect(personal.status).toBeGreaterThanOrEqual(400);
    expect(sockets).toHaveLength(0);
    expect(startCalls).toEqual([]);
  });

  it("flags only the rejected account: a sibling on the same provider keeps its own state", async () => {
    startHandler = (_url, init) => (init.headers.Authorization === "Bearer rejected" ? new Response("no", { status: 401 }) : startOk());
    script = { onFrame: copilotReply("sibling") };
    const a = await save("copilot-web", "rejected", "a", { priority: 1 });
    const b = await save("copilot-web", "healthy", "b", { priority: 2 });
    expect((await chat("copilot-web/copilot-pro", { stream: false })).status).toBe(200);
    expect(await stored(a.body.connection.id)).toMatchObject({ testStatus: "unavailable", errorCode: 401 });
    const sibling = await stored(b.body.connection.id);
    expect(sibling.errorCode ?? null).toBeNull();
    expect(sibling.testStatus).not.toBe("unavailable");
  });
});
