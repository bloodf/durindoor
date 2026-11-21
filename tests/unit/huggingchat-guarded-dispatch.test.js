/**
 * #2034: HuggingChat guarded session dispatch, offline.
 *
 * The guard (501 provider_port_pending) stays closed unless a connection sets
 * providerSpecificData.enableSessionDispatch === true. Real: sqlite DB, provider routes, handleChat,
 * account fallback, the Messages and Responses routes, executors. Synthetic: every cookie and every outbound
 * byte (global fetch is a closed mock of the three huggingface.co/chat requests). No live provider traffic.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-hf-guarded-machine-id" }));

const HF = "https://huggingface.co/chat";
const MODEL = "huggingchat/Qwen/Qwen3.6-27B";

let root;
let db;
let routes;
let handleChat;
let outbound;
let seen;

const json = (url, body, method = "POST") =>
  new Request(`http://gateway.invalid${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });
const jsonl = (...events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
const lockFields = (row) => Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);

async function addConnection(name, cookie, priority, providerSpecificData) {
  const res = await routes.providers.POST(json("/api/providers", { provider: "huggingchat", name, apiKey: cookie, priority, providerSpecificData }));
  expect(res.status).toBe(201);
  return (await res.json()).connection;
}
const chat = (extra = {}, content = "hello") =>
  handleChat(json("/v1/chat/completions", { model: MODEL, messages: [{ role: "user", content }], ...extra }));
const hfCalls = () => outbound.mock.calls.filter(([url]) => /huggingface\.co/.test(String(url)));

// Closed mock of the pinned contract (OmniRoute huggingchat.ts): create -> lookup -> multipart send -> JSONL.
// `sessions` maps a live hf-chat value to its conversation id; anything else is an expired session.
function huggingChat({ sessions, reply = jsonl({ type: "status", status: "started" }, { type: "stream", token: "po\0\0" }, { type: "stream", token: "ng" }, { type: "finalAnswer", text: "pong" }), createStatus, lookupStatus, sendStatus } = {}) {
  return async (url, init = {}) => {
    const target = String(url);
    const cookie = init.headers?.Cookie ?? "";
    const session = /hf-chat=([^;]+)/.exec(cookie)?.[1];
    const record = { url: target, method: init.method, cookie, body: init.body };
    seen.push(record);
    if (!target.startsWith(HF) && !target.startsWith("https://huggingface.co/")) throw new Error(`unexpected outbound ${target}`);
    const conversationId = sessions[session];
    if (target === `${HF}/conversation`) {
      if (createStatus) return new Response("", { status: createStatus });
      if (!conversationId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      return Response.json({ conversationId });
    }
    if (target.startsWith(`${HF}/api/v2/conversations/`)) {
      if (lookupStatus) return new Response("", { status: lookupStatus });
      if (target.endsWith(`/${conversationId}`)) return Response.json({ json: { rootMessageId: `root-${conversationId}` } });
      return new Response("", { status: 404 });
    }
    if (target.startsWith(`${HF}/conversation/`)) {
      if (sendStatus) return new Response("", { status: sendStatus });
      if (!target.endsWith(`/${conversationId}`)) return new Response("", { status: 403 });
      return new Response(reply, { status: 200, headers: { "content-type": "application/jsonl" } });
    }
    throw new Error(`unexpected outbound ${target}`);
  };
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hf-guarded-"));
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
    models: await import("../../src/app/api/v1/models/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
    responses: await import("../../src/app/api/v1/responses/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("HuggingChat guarded dispatch: flag off", () => {
  it.each([
    ["absent", undefined],
    ["false", { enableSessionDispatch: false }],
    ["truthy but not true", { enableSessionDispatch: "true" }],
  ])("keeps the 501 guard and sends nothing when the flag is %s", async (_label, data) => {
    await addConnection("hf-off", "hf-chat=synthetic-off", 1, data);
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-off": "conv-off" } }));
    for (const [label, request] of [
      ["chat json", () => chat()],
      ["chat stream", () => chat({ stream: true })],
      ["messages", () => routes.messages.POST(json("/v1/messages", { model: MODEL, max_tokens: 8, messages: [{ role: "user", content: "hi" }] }))],
      ["responses", () => routes.responses.POST(json("/v1/responses", { model: MODEL, input: "hi" }))],
    ]) {
      const res = await request();
      expect(res.status, label).toBe(501);
      const text = await res.text();
      expect(text, label).toMatch(/runtime execution is not ported yet/);
      expect(text, label).not.toContain("synthetic-off");
    }
    expect(hfCalls()).toEqual([]);
  });

  it("keeps the direct executor closed and never vends a credentialed header or URL", async () => {
    const executor = (await import("../../open-sse/executors/index.js")).getExecutor("huggingchat");
    expect(() => executor.buildHeaders({ apiKey: "hf-chat=synthetic-off" })).toThrow();
    expect(() => executor.buildUrl(MODEL, true)).toThrow();
    const result = await executor.execute({ model: "Qwen/Qwen3.6-27B", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: "hf-chat=synthetic-off", providerSpecificData: {} } });
    expect(result.response.status).toBe(501);
    expect((await result.response.json()).error.type).toBe("provider_port_pending");
    expect(hfCalls()).toEqual([]);
  });
});

describe("HuggingChat guarded dispatch: flag on", () => {
  const COOKIE = "hf-chat=synthetic-a";
  const live = () => huggingChat({ sessions: { "synthetic-a": "conv-a" } });

  it("bootstraps a conversation and returns a JSON chat completion", async () => {
    const a = await addConnection("hf-a", COOKIE, 1, { enableSessionDispatch: true });
    expect(a.providerSpecificData?.enableSessionDispatch).toBe(true);
    expect(JSON.stringify(a)).not.toContain("synthetic-a");
    outbound.mockImplementation(live());

    const res = await chat({}, "ping");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe("pong");

    // Bootstrap order and request shape from the pinned contract.
    expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${HF}/conversation`,
      `GET ${HF}/api/v2/conversations/conv-a`,
      `POST ${HF}/conversation/conv-a`,
    ]);
    expect(seen.every((call) => call.cookie === COOKIE)).toBe(true);
    const sent = JSON.parse(seen[2].body.get("data"));
    expect(sent).toMatchObject({ inputs: "ping", id: "root-conv-a", is_retry: false, is_continue: false });
  });

  it("streams JSONL as OpenAI chunks and forwards system text as the conversation preprompt", async () => {
    await addConnection("hf-a", COOKIE, 1, { enableSessionDispatch: true });
    outbound.mockImplementation(live());
    const res = await handleChat(json("/v1/chat/completions", {
      model: MODEL,
      stream: true,
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "ping" }],
    }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain('"content":"po"');
    expect(text).toContain('"content":"ng"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    expect(text).not.toContain("\\u0000");
    expect(JSON.parse(seen[0].body)).toEqual({ model: "Qwen/Qwen3.6-27B", preprompt: "be brief" });
  });

  it("serves Anthropic Messages and OpenAI Responses clients, JSON and streamed", async () => {
    await addConnection("hf-a", COOKIE, 1, { enableSessionDispatch: true });
    outbound.mockImplementation(live());
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));

    const message = await post("messages", { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content.some((block) => block.text === "pong")).toBe(true);
    const messageStream = await (await post("messages", { model: MODEL, max_tokens: 16, stream: true, messages: [{ role: "user", content: "ping" }] })).text();
    expect(messageStream).toContain("event: message_start");
    expect(messageStream).toContain("pong".slice(0, 2));
    expect(messageStream).toContain("event: message_stop");

    const response = await post("responses", { model: MODEL, input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("pong");
    const responseStream = await (await post("responses", { model: MODEL, input: "ping", stream: true })).text();
    expect(responseStream).toContain("response.completed");
    expect(hfCalls().every(([url]) => new URL(String(url)).hostname === "huggingface.co")).toBe(true);
  });

  it("surfaces reasoning tokens and keeps the static model catalog (no provider call to list)", async () => {
    await addConnection("hf-a", COOKIE, 1, { enableSessionDispatch: true });
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-a": "conv-a" }, reply: jsonl({ type: "reasoning", subtype: "stream", token: "think" }, { type: "stream", token: "ok" }, { type: "finalAnswer", text: "ok" }) }));
    expect((await (await chat()).json()).choices[0].message).toMatchObject({ content: "ok", reasoning_content: "think" });

    const before = hfCalls().length;
    const ids = (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
    expect(ids).toContain(MODEL);
    expect(hfCalls().length).toBe(before);
  });

  it("does not turn Validate into a conversation probe", async () => {
    const res = await (await routes.validate.POST(json("/api/providers/validate", { provider: "huggingchat", apiKey: COOKIE }))).json();
    expect(res).toMatchObject({ valid: false, skipped: true });
    expect(hfCalls()).toEqual([]);
  });

  it("returns a 502 for a generation error before any content, JSON and streamed", async () => {
    await addConnection("hf-a", COOKIE, 1, { enableSessionDispatch: true });
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-a": "conv-a" }, reply: jsonl({ type: "status", status: "error", message: "model overloaded" }) }));
    for (const extra of [{}, { stream: true }]) {
      const res = await chat(extra);
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain("synthetic-a");
    }
    // The executor itself reports the upstream message; the gateway only flattens it for clients.
    const executor = new (await import("../../open-sse/executors/huggingchat.js")).HuggingChatExecutor();
    for (const stream of [false, true]) {
      const direct = await executor.execute({ model: "Qwen/Qwen3.6-27B", stream, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: COOKIE } });
      expect(direct.response.status).toBe(502);
      expect(await direct.response.json()).toMatchObject({ error: { message: "model overloaded", code: "huggingchat_generation_error" } });
    }
  });
});

describe("HuggingChat guarded dispatch: expiry and quota", () => {
  const OLD = "hf-chat=synthetic-old";

  it.each([401, 403])("maps %i at session creation to a credential error with re-import guidance", async (status) => {
    await addConnection("hf-old", OLD, 1, { enableSessionDispatch: true });
    outbound.mockImplementation(huggingChat({ sessions: {}, createStatus: status }));
    const res = await chat();
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(text).toMatch(/expired or revoked/);
    expect(text).toMatch(/re-import/i);
    expect(text).not.toContain("synthetic-old");
    const row = (await db.getProviderConnections({ provider: "huggingchat" }))[0];
    expect(lockFields(row).length + (row.errorCode ? 1 : 0)).toBeGreaterThan(0);
  });

  it("treats a 401 on the conversation lookup and on the send as expiry too", async () => {
    await addConnection("hf-old", OLD, 1, { enableSessionDispatch: true });
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-old": "conv-old" }, lookupStatus: 401 }));
    const lookup = await chat();
    expect(lookup.status).toBe(401);
    expect(await lookup.text()).toMatch(/re-import/i);

    await routes.provider.DELETE(json("", null, "DELETE"), params((await db.getProviderConnections({ provider: "huggingchat" }))[0].id));
    await addConnection("hf-old-2", OLD, 1, { enableSessionDispatch: true });
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-old": "conv-old" }, sendStatus: 403 }));
    const send = await chat();
    expect(send.status).toBe(403);
    expect(await send.text()).toMatch(/re-import/i);
  });

  it("falls back from the expired connection to a live one, then recovers after re-import", async () => {
    const expired = await addConnection("hf-old", OLD, 1, { enableSessionDispatch: true });
    const liveRow = await addConnection("hf-live", "hf-chat=synthetic-live", 2, { enableSessionDispatch: true });
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-live": "conv-live" } }));
    const res = await chat();
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("pong");
    const expiredAfter = await db.getProviderConnectionById(expired.id);
    expect(expiredAfter.errorCode ?? expiredAfter.lastErrorCode ?? lockFields(expiredAfter).length).toBeTruthy();
    expect(lockFields(await db.getProviderConnectionById(liveRow.id))).toEqual([]);

    // Re-import: the Edit dialog PUTs a fresh cookie; the opt-in on the connection survives.
    const put = await routes.provider.PUT(json(`/api/providers/${expired.id}`, { apiKey: "hf-chat=synthetic-new", testStatus: "unknown", lastError: null, lastErrorAt: null }, "PUT"), params(expired.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(expired.id);
    expect(reimported.apiKey).toBe("hf-chat=synthetic-new");
    expect(reimported.providerSpecificData?.enableSessionDispatch).toBe(true);
    expect(lockFields(reimported)).toEqual([]);
  });

  it("maps 429 to a quota error at every step without echoing the cookie", async () => {
    for (const step of [{ createStatus: 429 }, { lookupStatus: 429 }, { sendStatus: 429 }]) {
      // A 429 cools the connection down, so each step runs against a fresh one.
      for (const row of await db.getProviderConnections({ provider: "huggingchat" })) await routes.provider.DELETE(json("", null, "DELETE"), params(row.id));
      await addConnection("hf-a", "hf-chat=synthetic-a", 1, { enableSessionDispatch: true });
      outbound.mockImplementation(huggingChat({ sessions: { "synthetic-a": "conv-a" }, ...step }));
      const res = await chat();
      expect(res.status, JSON.stringify(step)).toBe(429);
      const text = await res.text();
      expect(text).not.toContain("synthetic-a");
      expect(text).toMatch(/quota|rate limit/i);
    }
  });
});

describe("HuggingChat guarded dispatch: connection isolation", () => {
  it("opens only the opted-in connection; a sibling without the flag stays guarded and never sends its cookie", async () => {
    const on = await addConnection("hf-on", "hf-chat=synthetic-on", 1, { enableSessionDispatch: true });
    const off = await addConnection("hf-off", "hf-chat=synthetic-off", 2);
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-on": "conv-on", "synthetic-off": "conv-off" } }));

    expect((await chat()).status).toBe(200);
    expect(seen.length).toBe(3);
    expect(seen.every((call) => call.cookie === "hf-chat=synthetic-on")).toBe(true);

    // With the opted-in connection out of rotation the guarded one answers 501; it is not opened by its sibling.
    seen.length = 0;
    outbound.mockClear();
    await db.updateProviderConnection(on.id, { isActive: false });
    const res = await chat();
    expect(res.status).toBe(501);
    expect(await res.text()).toMatch(/runtime execution is not ported yet/);
    expect(hfCalls()).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain("synthetic-off");
    expect(lockFields(await db.getProviderConnectionById(off.id))).toEqual([]);
  });

  it("keeps each opted-in session's cookie and conversation bound to its own connection", async () => {
    const a = await addConnection("hf-a", "hf-chat=synthetic-a", 1, { enableSessionDispatch: true });
    await addConnection("hf-b", "hf-chat=synthetic-b", 2, { enableSessionDispatch: true });
    outbound.mockImplementation(huggingChat({ sessions: { "synthetic-a": "conv-a", "synthetic-b": "conv-b" } }));

    expect((await chat()).status).toBe(200);
    expect(seen.map((call) => call.cookie)).toEqual(Array(3).fill("hf-chat=synthetic-a"));
    expect(seen.map((call) => call.url)).toEqual([`${HF}/conversation`, `${HF}/api/v2/conversations/conv-a`, `${HF}/conversation/conv-a`]);

    seen.length = 0;
    await db.updateProviderConnection(a.id, { isActive: false });
    expect((await chat()).status).toBe(200);
    expect(seen.map((call) => call.cookie)).toEqual(Array(3).fill("hf-chat=synthetic-b"));
    expect(seen.map((call) => call.url)).toEqual([`${HF}/conversation`, `${HF}/api/v2/conversations/conv-b`, `${HF}/conversation/conv-b`]);
  });

  it("merges rotated Set-Cookie values into later requests of the same call only", async () => {
    await addConnection("hf-a", "hf-chat=synthetic-a", 1, { enableSessionDispatch: true });
    const base = huggingChat({ sessions: { "synthetic-a": "conv-a" } });
    outbound.mockImplementation(async (url, init) => {
      const res = await base(url, init);
      if (String(url) !== `${HF}/conversation`) return res;
      return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "set-cookie": "aux=rotated; Path=/" } });
    });
    expect((await chat()).status).toBe(200);
    expect(seen[0].cookie).toBe("hf-chat=synthetic-a");
    expect(seen[1].cookie).toContain("aux=rotated");
    expect((await db.getProviderConnections({ provider: "huggingchat" }))[0].apiKey).toBe("hf-chat=synthetic-a");
  });
});
