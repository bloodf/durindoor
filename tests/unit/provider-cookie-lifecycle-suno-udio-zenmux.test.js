/**
 * #2034: Suno, Udio and ZenMux Free saved-cookie lifecycle, offline.
 *
 * Real: sqlite DB, provider routes, validate/test routes, /v1/models, handleChat,
 * the music submit/poll routes with durable media jobs, account fallback, executors and
 * the usage route. Synthetic: every credential and every outbound byte (global fetch is
 * closed unless a test opens it with a canned response). No live provider traffic,
 * real session, browser or Docker is involved.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const SUNO_URL = "https://studio-api.suno.ai/api/generate/v2/";
const UDIO_URL = "https://www.udio.com/api/generate-proxy";
const ZENMUX_URL = "https://zenmux.ai/api/anthropic/v1/messages";

let root;
let db;
let routes;
let handleChat;
let callerKey;
let seen;
let outbound;

const json = (url, body, method = "POST", headers = {}) =>
  new Request(`http://gateway.invalid${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const lockFields = (row) => Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);

async function addConnection(provider, name, apiKey, priority, providerSpecificData) {
  const res = await routes.providers.POST(json("/api/providers", { provider, name, apiKey, priority, providerSpecificData }));
  expect(res.status).toBe(201);
  return (await res.json()).connection;
}

const chat = (model, extra = {}) =>
  handleChat(json("/v1/chat/completions", { model, messages: [{ role: "user", content: "hello" }], ...extra }));
const authed = (url, body, method, headers = {}) => json(url, body, method, { Authorization: `Bearer ${callerKey}`, ...headers });
const submit = (model, headers = {}, extra = {}) =>
  routes.music.POST(authed("/v1/music/generations", { model, prompt: "synthetic song", instrumental: true, ...extra }, "POST", headers));
const poll = (id, connectionId, headers = {}) =>
  routes.musicGet.GET(
    authed(`/v1/music/generations/${id}`, null, "GET", { "x-9router-connection-id": connectionId, ...headers }),
    { params: Promise.resolve({ request_id: id }) },
  );
const usage = (id) => routes.usage.GET(json(`/api/usage/${id}`, null, "GET"), { params: Promise.resolve({ connectionId: id }) });

const sse = (...events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const zenmuxOk = (text = "pong") =>
  new Response(
    sse(
      { type: "message_start", message: { id: "m" } },
      { type: "content_block_delta", delta: { type: "text_delta", text } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ),
    { headers: { "Content-Type": "text/event-stream" } },
  );

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-lifecycle-media-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  seen = [];
  outbound = vi.fn((url, init) => { throw new Error(`unmocked outbound request ${init?.method || "GET"} ${String(url)}`); });
  vi.stubGlobal("fetch", outbound);
  db = await import("@/lib/db/index.js");
  routes = {
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    validate: await import("../../src/app/api/providers/validate/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    models: await import("../../src/app/api/v1/models/route.js"),
    modelsByKind: await import("../../src/app/api/v1/models/[...model]/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
    responses: await import("../../src/app/api/v1/responses/route.js"),
    music: await import("../../src/app/api/v1/music/generations/route.js"),
    musicGet: await import("../../src/app/api/v1/music/generations/[request_id]/route.js"),
    usage: await import("../../src/app/api/usage/[connectionId]/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  const created = await db.createApiKey("lifecycle caller", "synthetic-cookie-machine-id");
  callerKey = created.key;
}, 60_000);

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ZenMux Free saved cookie lifecycle", () => {
  it("saves, validates locally, discovers models and dispatches JSON and stream per account", async () => {
    const a = await addConnection("zenmux-free", "zmf-a", "foo=1; ctoken=tok-a; bar=2", 1);
    const b = await addConnection("zenmux-free", "zmf-b", "Cookie: ctoken=tok-b", 2);
    expect(a).toMatchObject({ provider: "zenmux-free", authType: "cookie" });
    expect(JSON.stringify([a, b])).not.toMatch(/tok-[ab]/);

    const ok = await (await routes.validate.POST(json("/api/providers/validate", { provider: "zenmux-free", apiKey: "foo=1; ctoken=tok-a" }))).json();
    expect(ok).toMatchObject({ skipped: true });
    const noToken = await (await routes.validate.POST(json("/api/providers/validate", { provider: "zenmux-free", apiKey: "foo=1" }))).json();
    expect(noToken).toMatchObject({ valid: false });
    expect(noToken.error).toMatch(/ctoken/);
    expect((await (await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id))).json()).skipped).toBe(true);
    expect(outbound).not.toHaveBeenCalled();

    const ids = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["zmf/deepseek/deepseek-chat", "zmf/stepfun/step-3.5-flash-free"]));

    outbound.mockImplementation(async (url, init) => {
      seen.push({ url: String(url), cookie: init.headers.Cookie, authorization: init.headers.Authorization });
      return zenmuxOk();
    });
    const jsonRes = await chat("zmf/deepseek/deepseek-chat");
    expect(jsonRes.status).toBe(200);
    expect((await jsonRes.json()).choices[0].message.content).toBe("pong");
    // deepseek ids take the DSML translate path, the others the passthrough path: both end with [DONE].
    for (const streamed of ["zmf/deepseek/deepseek-chat", "zmf/stepfun/step-3.5-flash-free"]) {
      const streamText = await (await chat(streamed, { stream: true })).text();
      expect(streamText).toContain('"content":"pong"');
      expect(streamText.trimEnd().endsWith("data: [DONE]")).toBe(true);
    }
    expect(seen).toHaveLength(3);
    // Priority order picks the first saved session; credentials never cross accounts.
    // Only the chat endpoint is contacted: the context preflight must not send the cookie as a
    // Bearer token (or the prompt) to a /count_tokens URL the session was never issued for.
    expect(seen.every((s) => s.url === `${ZENMUX_URL}?ctoken=tok-a` && s.cookie === "foo=1; ctoken=tok-a; bar=2" && s.authorization === undefined)).toBe(true);
  });

  it("serves Anthropic Messages and OpenAI Responses clients from the same saved cookie", async () => {
    await addConnection("zenmux-free", "zmf-a", "ctoken=tok-a", 1);
    outbound.mockImplementation(async () => zenmuxOk());
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));
    const message = await post("messages", { model: "zmf/deepseek/deepseek-chat", max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content[0].text).toBe("pong");
    const response = await post("responses", { model: "zmf/deepseek/deepseek-chat", input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("pong");
    expect(outbound.mock.calls.every(([url]) => String(url).startsWith(ZENMUX_URL))).toBe(true);
  });

  it("falls back from an expired session, reports quota exhaustion, and recovers after re-paste", async () => {
    const expired = await addConnection("zenmux-free", "expired", "ctoken=old", 1);
    const live = await addConnection("zenmux-free", "live", "ctoken=live", 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    const answer = (liveTokens) => async (url, init) => {
      seen.push({ cookie: init.headers.Cookie });
      return liveTokens.has(init.headers.Cookie) ? zenmuxOk("ok") : new Response("", { status: 401 });
    };
    outbound.mockImplementation(answer(new Set(["ctoken=live"])));
    const res = await chat("zmf/deepseek/deepseek-chat");
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.cookie)).toEqual(["ctoken=old", "ctoken=live"]);
    const staleRow = await db.getProviderConnectionById(expired.id);
    expect(lockFields(staleRow).length).toBeGreaterThan(0);
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    const put = await routes.provider.PUT(json(`/api/providers/${expired.id}`, { apiKey: "ctoken=fresh" }, "PUT"), params(expired.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(expired.id);
    expect(reimported.apiKey).toBe("ctoken=fresh");
    expect(lockFields(reimported)).toEqual([]);

    seen = [];
    outbound.mockImplementation(answer(new Set(["ctoken=fresh", "ctoken=live"])));
    expect((await chat("zmf/deepseek/deepseek-chat")).status).toBe(200);
    expect(seen.map((s) => s.cookie)).toEqual(["ctoken=fresh"]);
  });

  it("returns an actionable 401 for the only expired session and 402 for exhausted quota", async () => {
    const only = await addConnection("zenmux-free", "only", "ctoken=old");
    outbound.mockImplementation(async () => new Response("", { status: 403 }));
    const res = await chat("zmf/deepseek/deepseek-chat");
    expect(res.status).toBe(401);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/cookies expired or invalid/i);
    expect(text).not.toContain("ctoken=old");

    // Re-paste clears the cooldown; a later free-tier quota answer keeps its own status.
    await routes.provider.PUT(json(`/api/providers/${only.id}`, { apiKey: "ctoken=fresh" }, "PUT"), params(only.id));
    outbound.mockImplementation(async () => new Response("", { status: 402 }));
    const quota = await chat("zmf/deepseek/deepseek-chat");
    expect(quota.status).toBe(402);
    expect(JSON.stringify(await quota.json())).toMatch(/free-tier quota exhausted/i);
  });

  it("rejects a cookie without ctoken locally without contacting zenmux.ai", async () => {
    await addConnection("zenmux-free", "no-token", "foo=1; bar=2");
    const res = await chat("zmf/deepseek/deepseek-chat");
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).toMatch(/ctoken not found/i);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("summarises only DurinDoor's own recorded requests for a saved session", async () => {
    const mine = await addConnection("zenmux-free", "mine", "ctoken=mine", 1);
    const other = await addConnection("zenmux-free", "other", "ctoken=other", 2);
    expect((await (await usage(mine.id)).json()).message).toBe("ZenMux Free connected. No requests recorded in the last 30 days.");
    outbound.mockImplementation(async () => zenmuxOk("hello world"));
    // The chat response schedules usage persistence without awaiting it.
    const usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
    expect((await chat("zmf/deepseek/deepseek-chat")).status).toBe(200);
    expect(usageWrite).toHaveBeenCalledOnce();
    await usageWrite.mock.results[0].value;
    expect((await (await usage(mine.id)).json()).displayMessage).toBe("ZenMux Free connected. 1 requests in the last 30 days.");
    expect((await (await usage(other.id)).json()).message).toBe("ZenMux Free connected. No requests recorded in the last 30 days.");
  });
});

describe.each([
  ["suno", "chirp-v4", SUNO_URL, "/api/feed/v2", "ids"],
  ["udio", "udio-default", UDIO_URL, "/api/songs", "songIds"],
])("%s saved cookie lifecycle", (provider, model, submitUrl, pollPath, idParam) => {
  const modelId = `${provider}/${model}`;
  const submitted = () =>
    provider === "suno"
      ? reply({ clips: [{ id: "clip-1", status: "submitted" }] })
      : reply({ track_ids: ["clip-1"] });
  const finished = (status) =>
    provider === "suno"
      ? reply({ clips: [{ id: "clip-1", status, audio_url: "https://cdn.invalid/a.mp3", metadata: { duration: 3 } }] })
      : reply({ songs: [{ id: "clip-1", finished: status === "complete", song_path: "https://cdn.invalid/a.mp3" }] });

  it("saves, discovers, and does not probe the provider on Validate or Test", async () => {
    const a = await addConnection(provider, `${provider}-a`, "sid=synthetic-a", 1);
    expect(a).toMatchObject({ provider, authType: "cookie" });
    expect(JSON.stringify(a)).not.toContain("synthetic-a");
    const validated = await (await routes.validate.POST(json("/api/providers/validate", { provider, apiKey: "sid=synthetic-a" }))).json();
    // Skipping is deliberate: the only generic probe would POST the submit endpoint and start a generation.
    expect(validated).toMatchObject({ valid: false, skipped: true });
    const tested = await (await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id))).json();
    expect(tested).toMatchObject({ valid: false, skipped: true });
    expect(outbound).not.toHaveBeenCalled();
    // Music models are discoverable by kind and kept out of the chat list.
    const music = await routes.modelsByKind.GET(json("/v1/models/music", null, "GET"), { params: Promise.resolve({ model: ["music"] }) });
    expect(music.status).toBe(200);
    expect((await music.json()).data.map((m) => m.id)).toContain(modelId);
    const chatList = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
    expect(chatList).not.toContain(modelId);
  });

  it("submits and polls through the gateway on the submitting account only", async () => {
    const a = await addConnection(provider, `${provider}-a`, "sid=synthetic-a", 1);
    const b = await addConnection(provider, `${provider}-b`, "sid=synthetic-b", 2);
    outbound.mockImplementation(async (url, init) => {
      seen.push({ url: String(url), method: init.method, cookie: init.headers.Cookie });
      return seen.length === 1 ? submitted() : seen.length === 2 ? finished(provider === "suno" ? "streaming" : "pending") : finished("complete");
    });
    const res = await submit(modelId);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-9router-connection-id")).toBe(a.id);
    expect(await res.json()).toMatchObject({ object: "music.generation", status: "submitted", request_id: "clip-1" });
    expect(seen[0]).toMatchObject({ url: submitUrl, method: "POST", cookie: "sid=synthetic-a" });

    // Another account can neither see nor poll the job.
    expect((await poll("clip-1", b.id)).status).toBe(404);
    expect(seen).toHaveLength(1);

    expect(await (await poll("clip-1", a.id)).json()).toMatchObject({ status: "submitted" });
    const done = await poll("clip-1", a.id);
    expect(await done.json()).toMatchObject({ status: "completed", data: [{ id: "clip-1", audio_url: "https://cdn.invalid/a.mp3" }] });
    expect(seen.slice(1).every((s) => s.method === "GET" && s.cookie === "sid=synthetic-a")).toBe(true);
    const pollUrl = new URL(seen[2].url);
    expect(pollUrl.pathname).toBe(pollPath);
    expect(pollUrl.searchParams.get(idParam)).toBe("clip-1");
    // Terminal jobs replay from the durable record without another upstream call.
    const before = outbound.mock.calls.length;
    expect((await poll("clip-1", a.id)).status).toBe(200);
    expect(outbound.mock.calls.length).toBe(before);
  });

  it("settles usage per connection and surfaces it on the usage route", async () => {
    const a = await addConnection(provider, `${provider}-a`, "sid=synthetic-a", 1);
    const b = await addConnection(provider, `${provider}-b`, "sid=synthetic-b", 2);
    outbound.mockImplementation(async () => (outbound.mock.calls.length === 1 ? submitted() : finished("complete")));
    expect((await submit(modelId)).status).toBe(200);
    expect((await poll("clip-1", a.id)).status).toBe(200);
    await vi.waitFor(async () => {
      const summary = await (await usage(a.id)).json();
      expect(JSON.stringify(summary)).toMatch(/1 requests in the last 30 days/);
    });
    expect((await (await usage(b.id)).json()).message).toMatch(/No requests recorded/);
  });

  it("falls back from an expired session on submit and recovers after re-paste", async () => {
    const expired = await addConnection(provider, "expired", "sid=old", 1);
    const live = await addConnection(provider, "live", "sid=live", 2);
    outbound.mockImplementation(async (_url, init) => {
      seen.push(init.headers.Cookie);
      return init.headers.Cookie === "sid=old" ? reply({ message: "session expired" }, 401) : submitted();
    });
    const res = await submit(modelId);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["sid=old", "sid=live"]);
    expect(res.headers.get("x-9router-connection-id")).toBe(live.id);
    expect(lockFields(await db.getProviderConnectionById(expired.id)).length).toBeGreaterThan(0);

    const put = await routes.provider.PUT(json(`/api/providers/${expired.id}`, { apiKey: "sid=fresh" }, "PUT"), params(expired.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(expired.id);
    expect(reimported.apiKey).toBe("sid=fresh");
    expect(lockFields(reimported)).toEqual([]);
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe("sid=live");

    seen = [];
    outbound.mockImplementation(async (_url, init) => { seen.push(init.headers.Cookie); return reply(provider === "suno" ? { clips: [{ id: "clip-2", status: "submitted" }] } : { track_ids: ["clip-2"] }); });
    const again = await submit(modelId);
    expect(again.status).toBe(200);
    expect(seen).toEqual(["sid=fresh"]);
  });

  it("keeps a poll bound to its connection when that session expires, and polls with the re-pasted cookie", async () => {
    const a = await addConnection(provider, `${provider}-a`, "sid=old", 1);
    const b = await addConnection(provider, `${provider}-b`, "sid=live", 2);
    outbound.mockImplementationOnce(async () => submitted());
    expect((await submit(modelId)).headers.get("x-9router-connection-id")).toBe(a.id);

    outbound.mockImplementation(async (_url, init) => { seen.push(init.headers.Cookie); return reply({ message: "session expired" }, 401); });
    const expired = await poll("clip-1", a.id);
    expect(expired.status).toBe(401);
    expect(seen).toEqual(["sid=old"]);
    expect(JSON.stringify(await expired.json())).not.toContain("sid=old");
    // Sibling session is never consulted for the job.
    expect(seen).not.toContain("sid=live");

    await routes.provider.PUT(json(`/api/providers/${a.id}`, { apiKey: "sid=fresh" }, "PUT"), params(a.id));
    seen = [];
    outbound.mockImplementation(async (_url, init) => { seen.push(init.headers.Cookie); return finished("complete"); });
    const done = await poll("clip-1", a.id);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ status: "completed" });
    expect(seen).toEqual(["sid=fresh"]);
    expect(b.id).not.toBe(a.id);
  });
});
