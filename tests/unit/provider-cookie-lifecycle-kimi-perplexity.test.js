/**
 * #2034: Kimi Web and Perplexity Web saved-cookie lifecycle, offline.
 *
 * Real: sqlite DB, provider routes, validate/test/discovery routes, /v1/models, handleChat,
 * the /v1/messages and /v1/responses entry points, account fallback, executors and the
 * usage route. Synthetic: every credential and every outbound byte (global fetch).
 * No live provider traffic, real session, browser or Docker is involved.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const SESSION = "__Secure-next-auth.session-token";
const KIMI_COM = "https://www.kimi.com";
const KIMI_AI = "https://www.kimi.ai";
const KIMI_CHAT = "/apiv2/kimi.gateway.chat.v1.ChatService/Chat";
const KIMI_MODELS = "/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels";
const KIMI_REFRESH = "/api/account.gateway.v1.AuthService/RefreshToken";
const PPLX_ASK = "https://www.perplexity.ai/rest/sse/perplexity_ask";
const PPLX_SESSION = "https://www.perplexity.ai/api/auth/session";

// Synthetic JWT-shaped tokens; none of these is a real credential.
const jwt = (tag) => `eyJhbGciOiJIUzUxMiJ9.eyJ0YWciOiJ${tag}In0.sig${tag}`;

let root;
let db;
let routes;
let handleChat;
let seen;
let outbound;

const json = (url, body, method = "POST") =>
  new Request(`http://gateway.invalid${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });
const lockFields = (row) => Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);

async function addConnection(provider, name, apiKey, providerSpecificData, priority) {
  const res = await routes.providers.POST(json("/api/providers", { provider, name, apiKey, providerSpecificData, priority }));
  expect(res.status).toBe(201);
  return (await res.json()).connection;
}

const chat = (model, extra = {}) =>
  handleChat(json("/v1/chat/completions", { model, messages: [{ role: "user", content: "hello" }], ...extra }));

// The first case transforms every route and the gateway cold, which outlasts the 10s hook default.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const usage = (id) => routes.usage.GET(json(`/api/usage/${id}`, null, "GET"), { params: Promise.resolve({ connectionId: id }) });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-lifecycle-kp-"));
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
    discovery: await import("../../src/app/api/providers/[id]/models/route.js"),
    models: await import("../../src/app/api/v1/models/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
    responses: await import("../../src/app/api/v1/responses/route.js"),
    usage: await import("../../src/app/api/usage/[connectionId]/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60_000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Kimi Web saved session lifecycle", () => {
  const paste = (access, refresh, origin) => JSON.stringify({ access_token: access, ...(refresh ? { refresh_token: refresh } : null), ...(origin ? { origin } : null) });
  const frame = (message, flags = 0) => {
    const payload = new TextEncoder().encode(JSON.stringify(message));
    const out = new Uint8Array(5 + payload.length);
    out[0] = flags;
    new DataView(out.buffer).setUint32(1, payload.length);
    out.set(payload, 5);
    return out;
  };
  const kimiAnswer = (text) => {
    const frames = [
      frame({ op: "append", mask: "block.text.content", block: { text: { content: text } } }),
      frame({ message: { role: "assistant", status: "MESSAGE_STATUS_COMPLETED" } }),
    ];
    const body = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
    let offset = 0;
    for (const f of frames) { body.set(f, offset); offset += f.length; }
    return new Response(body, { headers: { "Content-Type": "application/connect+json" } });
  };
  const bearerOf = (init) => String(init?.headers?.Authorization ?? "").replace(/^Bearer /, "");
  // The fake Kimi deployments: a token is live while it is in `live`; the refresh host swaps a
  // refresh token for the pair in `refreshes`. Every call is recorded with its origin.
  const kimi = ({ live, refreshes = {} }) => async (url, init) => {
    const target = new URL(String(url));
    seen.push({ origin: target.origin, path: target.pathname, bearer: bearerOf(init), body: init?.body });
    if (target.pathname === KIMI_REFRESH) {
      const next = refreshes[JSON.parse(init.body).refresh_token];
      return next ? Response.json({ access_token: next.access, refresh_token: next.refresh }) : new Response("{}", { status: 401 });
    }
    if (!live.has(bearerOf(init))) return new Response("unauthenticated", { status: 401 });
    if (target.pathname === KIMI_MODELS) {
      return Response.json({ availableModels: [{ key: "k3", displayName: "K3" }, { key: "k2d6", displayName: "K2.6 Instant" }] });
    }
    return kimiAnswer("kimi pong");
  };
  const chats = () => seen.filter((call) => call.path === KIMI_CHAT);

  it("saves two deployments, validates, discovers and dispatches JSON and stream per origin", async () => {
    const com = await addConnection("kimi-web", "kimi-com", paste(jwt("A"), jwt("RA")), undefined, 1);
    const ai = await addConnection("kimi-web", "kimi-ai", paste(jwt("B"), jwt("RB"), KIMI_AI), undefined, 2);
    expect(com).toMatchObject({ provider: "kimi-web", authType: "cookie" });
    expect(JSON.stringify([com, ai])).not.toMatch(/eyJ/);
    outbound.mockImplementation(kimi({ live: new Set([jwt("A"), jwt("B")]) }));

    // Validate and Test probe the model service on the deployment each session came from.
    const ok = await (await routes.validate.POST(json("/api/providers/validate", { provider: "kimi-web", apiKey: paste(jwt("B"), jwt("RB"), KIMI_AI) }))).json();
    expect(ok).toMatchObject({ valid: true });
    expect(seen.map((s) => [s.origin, s.path, s.bearer])).toEqual([[KIMI_AI, KIMI_MODELS, jwt("B")]]);
    const bad = await (await routes.validate.POST(json("/api/providers/validate", { provider: "kimi-web", apiKey: paste(jwt("X"), jwt("RX")) }))).json();
    expect(bad).toMatchObject({ valid: false });
    expect(JSON.stringify(bad)).not.toContain(jwt("X"));
    seen.length = 0;
    const tested = await (await routes.test.POST(json(`/api/providers/${ai.id}/test`, {}), params(ai.id))).json();
    expect(tested).toMatchObject({ valid: true });
    expect(seen.map((s) => [s.origin, s.bearer])).toEqual([[KIMI_AI, jwt("B")]]);

    // Per-connection discovery stays on that connection's deployment and token.
    seen.length = 0;
    const found = await (await routes.discovery.GET(json(`/api/providers/${com.id}/models?refresh=true`, null, "GET"), params(com.id))).json();
    expect(found.models.map((m) => m.id)).toEqual(expect.arrayContaining(["k3", "k2d6"]));
    expect(seen.map((s) => [s.origin, s.path, s.bearer])).toEqual([[KIMI_COM, KIMI_MODELS, jwt("A")]]);

    const ids = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["kimi-web/k3", "kimi-web/k2d6"]));

    seen.length = 0;
    const jsonRes = await chat("kimi-web/k3");
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("kimi pong");
    const streamText = await (await chat("kimi-web/k3", { stream: true })).text();
    expect(streamText).toContain('"content":"kimi pong"');
    expect(streamText).toContain("[DONE]");
    // Priority picks the first saved session; its token never reaches the other deployment.
    expect(chats().map((c) => [c.origin, c.bearer])).toEqual([[KIMI_COM, jwt("A")], [KIMI_COM, jwt("A")]]);

    seen.length = 0;
    await db.updateProviderConnection(com.id, { isActive: false });
    expect((await chat("kimi-web/k3")).status).toBe(200);
    expect(chats().map((c) => [c.origin, c.bearer])).toEqual([[KIMI_AI, jwt("B")]]);
    expect(JSON.stringify(chats()[0])).not.toContain(jwt("RB"));
  });

  it("serves Anthropic Messages and OpenAI Responses clients from the same saved session", async () => {
    await addConnection("kimi-web", "kimi-com", paste(jwt("A"), jwt("RA")));
    outbound.mockImplementation(kimi({ live: new Set([jwt("A")]) }));
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));

    const message = await post("messages", { model: "kimi-web/k3", max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content[0].text).toBe("kimi pong");
    const messageStream = await (await post("messages", { model: "kimi-web/k3", max_tokens: 16, stream: true, messages: [{ role: "user", content: "ping" }] })).text();
    expect(messageStream).toContain("event: message_start");
    expect(messageStream).toContain("event: message_stop");
    const response = await post("responses", { model: "kimi-web/k3", input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("kimi pong");
    const responseStream = await (await post("responses", { model: "kimi-web/k3", input: "ping", stream: true })).text();
    expect(responseStream).toContain("response.completed");
  });

  it("refreshes an expired access token once, persists the rotation to that connection only", async () => {
    const a = await addConnection("kimi-web", "kimi-a", paste(jwt("A"), jwt("RA")), undefined, 1);
    const b = await addConnection("kimi-web", "kimi-b", paste(jwt("B"), jwt("RB")), undefined, 2);
    const bBefore = await db.getProviderConnectionById(b.id);
    outbound.mockImplementation(kimi({ live: new Set([jwt("A2"), jwt("B")]), refreshes: { [jwt("RA")]: { access: jwt("A2"), refresh: jwt("RA2") } } }));

    expect((await chat("kimi-web/k3")).status).toBe(200);
    expect(seen.map((s) => [s.path === KIMI_REFRESH ? "refresh" : "chat", s.bearer])).toEqual([["chat", jwt("A")], ["refresh", ""], ["chat", jwt("A2")]]);
    const rotated = await db.getProviderConnectionById(a.id);
    expect(rotated.accessToken).toBe(jwt("A2"));
    expect(rotated.refreshToken).toBe(jwt("RA2"));
    expect(lockFields(rotated)).toEqual([]);
    const siblingAfter = await db.getProviderConnectionById(b.id);
    expect(siblingAfter.accessToken ?? null).toBe(bBefore.accessToken ?? null);
    expect(siblingAfter.apiKey).toBe(bBefore.apiKey);

    // The rotated pair serves later requests without another refresh.
    seen.length = 0;
    expect((await chat("kimi-web/k3")).status).toBe(200);
    expect(seen.map((s) => s.bearer)).toEqual([jwt("A2")]);
  });

  it("falls back to a sibling when refresh fails, then recovers after the session is re-pasted", async () => {
    const stale = await addConnection("kimi-web", "stale", paste(jwt("S"), jwt("RS")), undefined, 1);
    const live = await addConnection("kimi-web", "live", paste(jwt("L"), jwt("RL")), undefined, 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    outbound.mockImplementation(kimi({ live: new Set([jwt("L")]) }));

    const res = await chat("kimi-web/k3");
    expect(res.status).toBe(200);
    expect(chats().map((c) => c.bearer)).toEqual([jwt("S"), jwt("L")]);
    const staleRow = await db.getProviderConnectionById(stale.id);
    expect(lockFields(staleRow).length).toBeGreaterThan(0);
    expect(JSON.stringify(staleRow.lastError ?? "")).not.toContain("eyJ");
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    const fresh = paste(jwt("F"), jwt("RF"));
    const put = await routes.provider.PUT(json(`/api/providers/${stale.id}`, { apiKey: fresh }, "PUT"), params(stale.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(stale.id);
    expect(reimported.apiKey).toBe(fresh);
    expect(lockFields(reimported)).toEqual([]);
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    seen.length = 0;
    outbound.mockImplementation(kimi({ live: new Set([jwt("F"), jwt("L")]) }));
    await db.updateProviderConnection(live.id, { isActive: false });
    expect((await chat("kimi-web/k3")).status).toBe(200);
    expect(chats().map((c) => c.bearer)).toEqual([jwt("F")]);
  });

  it("uses a re-pasted session instead of the rotation saved for the replaced one", async () => {
    const conn = await addConnection("kimi-web", "kimi", paste(jwt("A"), jwt("RA")));
    outbound.mockImplementation(kimi({ live: new Set([jwt("A2"), jwt("F")]), refreshes: { [jwt("RA")]: { access: jwt("A2"), refresh: jwt("RA2") } } }));
    expect((await chat("kimi-web/k3")).status).toBe(200);
    expect((await db.getProviderConnectionById(conn.id)).accessToken).toBe(jwt("A2"));

    // The stored rotation belongs to the old paste; a different paste must not inherit it.
    const fresh = paste(jwt("F"), jwt("RF"));
    expect((await routes.provider.PUT(json(`/api/providers/${conn.id}`, { apiKey: fresh }, "PUT"), params(conn.id))).status).toBe(200);
    seen.length = 0;
    expect((await chat("kimi-web/k3")).status).toBe(200);
    expect(chats().map((c) => c.bearer)).toEqual([jwt("F")]);
    expect(seen.some((c) => c.path === KIMI_REFRESH)).toBe(false);
  });

  it("reports an actionable 401 without the token when the only session cannot be refreshed", async () => {
    await addConnection("kimi-web", "only", paste(jwt("S"), jwt("RS")));
    outbound.mockImplementation(kimi({ live: new Set() }));
    const res = await chat("kimi-web/k3");
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("eyJ");
    expect(text).toMatch(/re-paste the new tokens/i);
  });

  it("summarises only DurinDoor's own recorded requests for a saved Kimi Web session", async () => {
    const mine = await addConnection("kimi-web", "mine", paste(jwt("A"), jwt("RA")), undefined, 1);
    const other = await addConnection("kimi-web", "other", paste(jwt("B"), jwt("RB")), undefined, 2);
    const empty = await (await usage(mine.id)).json();
    expect(empty.message).toBe("Kimi Web connected. No requests recorded in the last 30 days.");

    outbound.mockImplementation(kimi({ live: new Set([jwt("A")]) }));
    // The chat response schedules usage persistence without awaiting it.
    const usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
    expect((await chat("kimi-web/k3")).status).toBe(200);
    expect(usageWrite).toHaveBeenCalledOnce();
    await usageWrite.mock.results[0].value;
    expect((await (await usage(mine.id)).json()).displayMessage).toBe("Kimi Web connected. 1 requests in the last 30 days.");
    expect(Object.keys((await (await usage(mine.id)).json()).quotas)).toEqual(expect.arrayContaining(["Total tokens (30d)"]));
    expect((await (await usage(other.id)).json()).message).toBe("Kimi Web connected. No requests recorded in the last 30 days.");
  });
});

describe("Perplexity Web saved cookie lifecycle", () => {
  const chunked = (tag) => `${SESSION}.1=${tag}-b; ${SESSION}.0=${tag}-a`;
  const sse = (text) => `data: ${JSON.stringify({ backend_uuid: "private-thread", blocks: [{ intended_usage: "ask_text_0_markdown", markdown_block: { chunks: [text], progress: "DONE" } }], final: true })}\n\n`;
  // The fake site accepts a session while the first chunk's value is in `live`.
  const pplx = ({ live, text = "pplx pong" }) => async (url, init) => {
    const cookie = init?.headers?.Cookie ?? "";
    seen.push({ url: String(url), cookie, body: init?.body });
    const accepted = [...live].some((tag) => cookie.includes(`${tag}-a`));
    if (String(url) === PPLX_SESSION) return accepted ? Response.json({ user: { id: "synthetic" } }) : Response.json({});
    return accepted ? new Response(sse(text), { headers: { "Content-Type": "text/event-stream" } }) : new Response("", { status: 401 });
  };
  const asks = () => seen.filter((call) => call.url === PPLX_ASK);

  it("saves chunked cookies, validates read-only, discovers models and dispatches JSON and stream", async () => {
    const a = await addConnection("perplexity-web", "pplx-a", chunked("A"), undefined, 1);
    const b = await addConnection("perplexity-web", "pplx-b", chunked("B"), undefined, 2);
    expect(a).toMatchObject({ provider: "perplexity-web", authType: "cookie" });
    expect(JSON.stringify([a, b])).not.toMatch(/A-[ab]|B-[ab]/);
    outbound.mockImplementation(pplx({ live: ["A", "B"] }));

    const ok = await (await routes.validate.POST(json("/api/providers/validate", { provider: "perplexity-web", apiKey: chunked("A") }))).json();
    expect(ok).toMatchObject({ valid: true });
    expect(seen).toEqual([{ url: PPLX_SESSION, cookie: `${SESSION}.0=A-a; ${SESSION}.1=A-b`, body: undefined }]);
    const expired = await (await routes.validate.POST(json("/api/providers/validate", { provider: "perplexity-web", apiKey: chunked("X") }))).json();
    expect(expired).toMatchObject({ valid: false });
    expect(expired.error).toMatch(/re-paste/i);
    const tested = await (await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id))).json();
    expect(tested).toMatchObject({ valid: true });
    expect(asks()).toEqual([]);

    const ids = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["pw/pplx-auto", "pw/pplx-sonar"]));

    seen.length = 0;
    const jsonRes = await chat("pw/pplx-auto");
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("pplx pong");
    const streamText = await (await chat("pw/pplx-auto", { stream: true })).text();
    expect(streamText).toContain('"content":"pplx pong"');
    expect(streamText).toContain("[DONE]");
    expect(streamText).not.toContain("private-thread");
    expect(asks().map((c) => c.cookie)).toEqual([`${SESSION}.0=A-a; ${SESSION}.1=A-b`, `${SESSION}.0=A-a; ${SESSION}.1=A-b`]);

    seen.length = 0;
    await db.updateProviderConnection(a.id, { isActive: false });
    expect((await chat("pw/pplx-auto")).status).toBe(200);
    expect(asks().map((c) => c.cookie)).toEqual([`${SESSION}.0=B-a; ${SESSION}.1=B-b`]);
  });

  it("serves Anthropic Messages and OpenAI Responses clients from the same saved cookie", async () => {
    await addConnection("perplexity-web", "pplx-a", chunked("A"));
    outbound.mockImplementation(pplx({ live: ["A"] }));
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));

    const message = await post("messages", { model: "pw/pplx-auto", max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content[0].text).toBe("pplx pong");
    const messageStream = await (await post("messages", { model: "pw/pplx-auto", max_tokens: 16, stream: true, messages: [{ role: "user", content: "ping" }] })).text();
    expect(messageStream).toContain("event: message_start");
    expect(messageStream).toContain("event: message_stop");
    const response = await post("responses", { model: "pw/pplx-auto", input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("pplx pong");
    const responseStream = await (await post("responses", { model: "pw/pplx-auto", input: "ping", stream: true })).text();
    expect(responseStream).toContain("response.completed");
  });

  it("falls back from an expired session, keeps the sibling untouched, and recovers after re-paste", async () => {
    const stale = await addConnection("perplexity-web", "stale", chunked("old"), undefined, 1);
    const live = await addConnection("perplexity-web", "live", chunked("live"), undefined, 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    outbound.mockImplementation(pplx({ live: ["live"] }));

    const res = await chat("pw/pplx-auto");
    expect(res.status).toBe(200);
    expect(asks().map((c) => c.cookie.includes("old-a"))).toEqual([true, false]);
    const staleRow = await db.getProviderConnectionById(stale.id);
    expect(lockFields(staleRow).length).toBeGreaterThan(0);
    expect(JSON.stringify(staleRow.lastError ?? "")).not.toMatch(/old-[ab]/);
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    const put = await routes.provider.PUT(json(`/api/providers/${stale.id}`, { apiKey: chunked("fresh") }, "PUT"), params(stale.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(stale.id);
    expect(reimported.apiKey).toBe(chunked("fresh"));
    expect(lockFields(reimported)).toEqual([]);

    seen.length = 0;
    outbound.mockImplementation(pplx({ live: ["fresh", "live"] }));
    await db.updateProviderConnection(live.id, { isActive: false });
    expect((await chat("pw/pplx-auto")).status).toBe(200);
    expect(asks().map((c) => c.cookie)).toEqual([`${SESSION}.0=fresh-a; ${SESSION}.1=fresh-b`]);
  });

  it("returns an actionable 401 when the only session is expired", async () => {
    await addConnection("perplexity-web", "only", chunked("old"));
    outbound.mockImplementation(pplx({ live: [] }));
    const res = await chat("pw/pplx-auto");
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/re-paste your __Secure-next-auth\.session-token/i);
    expect(text).not.toMatch(/old-[ab]/);
  });

  it("keeps an upstream 429 as rate limiting, not as an expired session", async () => {
    await addConnection("perplexity-web", "busy", chunked("A"));
    outbound.mockImplementation(async () => new Response("", { status: 429 }));
    const res = await chat("pw/pplx-auto");
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).not.toMatch(/re-paste/i);
  });

  it("summarises only DurinDoor's own recorded requests for a saved Perplexity Web session", async () => {
    const mine = await addConnection("perplexity-web", "mine", chunked("A"), undefined, 1);
    const other = await addConnection("perplexity-web", "other", chunked("B"), undefined, 2);
    const empty = await (await usage(mine.id)).json();
    expect(empty.message).toBe("Perplexity Web connected. No requests recorded in the last 30 days.");

    outbound.mockImplementation(pplx({ live: ["A"] }));
    // The chat response schedules usage persistence without awaiting it.
    const usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
    expect((await chat("pw/pplx-auto")).status).toBe(200);
    expect(usageWrite).toHaveBeenCalledOnce();
    await usageWrite.mock.results[0].value;
    expect((await (await usage(mine.id)).json()).displayMessage).toBe("Perplexity Web connected. 1 requests in the last 30 days.");
    expect((await (await usage(other.id)).json()).message).toBe("Perplexity Web connected. No requests recorded in the last 30 days.");
  });
});
