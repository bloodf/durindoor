/**
 * #2034: Muse Spark Web, Yuanbao Web and HuggingChat saved-cookie lifecycle, offline.
 *
 * Real: sqlite DB, provider routes, validate/test routes, /v1/models, handleChat, account fallback,
 * executors and the usage route. Synthetic: every credential and every outbound byte (global fetch).
 * No live provider traffic, real session, browser or Docker is involved.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const CREATE_URL = "https://yuanbao.tencent.com/api/user/agent/conversation/create";
const CHAT_URL = "https://yuanbao.tencent.com/api/chat/synthetic-conversation";

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
const lockFields = (row) => Object.entries(row).filter(([key, value]) => key.startsWith("modelLock_") && value).map(([key]) => key);

async function addConnection(provider, name, apiKey, priority, providerSpecificData) {
  const res = await routes.providers.POST(json("/api/providers", { provider, name, apiKey, priority, providerSpecificData }));
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

// /v1/models may probe unrelated free-catalog hosts; what matters is that nothing reaches these providers.
const PROVIDER_HOSTS = /meta\.ai|huggingface\.co|tencent\.com/;
const providerCalls = () => outbound.mock.calls.filter(([url]) => PROVIDER_HOSTS.test(String(url)));
const modelIds = async () => (await (await routes.models.GET(json("/v1/models", null, "GET"))).json()).data.map((m) => m.id);
const usage = (id) => routes.usage.GET(json(`/api/usage/${id}`, null, "GET"), { params: Promise.resolve({ connectionId: id }) });
const sse = (...events) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");

describe("Yuanbao Web saved cookie lifecycle", () => {
  const COOKIE_A = "hy_user=user-a; hy_token=token-a";
  const sessionOf = (init) => init.headers.Cookie;
  // Closed mock: only cookies in `live` are accepted; every request and its cookie is recorded.
  const yuanbao = (live, reply = "pong") => async (url, init) => {
    seen.push({ url: String(url), cookie: sessionOf(init) });
    const token = /hy_token=([^;]+)/.exec(sessionOf(init))?.[1];
    if (!live.has(token)) return new Response("", { status: 401 });
    if (String(url) === CREATE_URL) return Response.json({ id: "synthetic-conversation" });
    if (String(url) === CHAT_URL) return new Response(sse({ type: "think", content: "why" }, { type: "text", msg: reply }, "[DONE]"));
    throw new Error(`unexpected outbound ${url}`);
  };

  it("saves, skips conversation probes, discovers the static catalog and dispatches JSON and stream", async () => {
    const a = await addConnection("yuanbao-web", "yb-a", COOKIE_A, 1);
    const b = await addConnection("yuanbao-web", "yb-b", "hy_user=user-b; hy_token=token-b", 2);
    expect(a).toMatchObject({ provider: "yuanbao-web", authType: "cookie" });
    expect(JSON.stringify([a, b])).not.toMatch(/token-[ab]/);

    const incomplete = await (await routes.validate.POST(json("/api/providers/validate", { provider: "yuanbao-web", apiKey: "hy_token=only-token" }))).json();
    expect(incomplete).toMatchObject({ valid: false, error: expect.stringMatching(/hy_user and hy_token/) });
    expect(incomplete.skipped).toBeUndefined();
    const validated = await (await routes.validate.POST(json("/api/providers/validate", { provider: "yuanbao-web", apiKey: COOKIE_A }))).json();
    expect(validated).toMatchObject({ valid: false, skipped: true });
    const tested = await (await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id))).json();
    expect(tested).toMatchObject({ valid: false, skipped: true });
    expect(outbound).not.toHaveBeenCalled();

    const ids = await modelIds();
    expect(ids).toEqual(expect.arrayContaining(["ybw/deepseek-v3", "ybw/deepseek-r1", "ybw/hunyuan", "ybw/hunyuan-t1-search"]));

    outbound.mockImplementation(yuanbao(new Set(["token-a", "token-b"])));
    const jsonRes = await chat("ybw/hunyuan");
    expect(jsonRes.status).toBe(200);
    const message = (await jsonRes.json()).choices[0].message;
    expect(message).toMatchObject({ content: "pong", reasoning_content: "why" });
    const streamText = await (await chat("ybw/deepseek-r1-search", { stream: true })).text();
    expect(streamText).toContain('"reasoning_content":"why"');
    expect(streamText).toContain('"content":"pong"');
    expect(streamText).toContain("[DONE]");

    // Priority order picks the first saved session; credentials never cross accounts or hosts.
    expect(seen).toHaveLength(4);
    expect(seen.every((call) => call.cookie === "hy_source=web; hy_user=user-a; hy_token=token-a")).toBe(true);
    expect(seen.every((call) => call.url.startsWith("https://yuanbao.tencent.com/"))).toBe(true);
  });

  it("serves Anthropic Messages and OpenAI Responses clients from the same saved cookie", async () => {
    await addConnection("yuanbao-web", "yb-a", COOKIE_A);
    outbound.mockImplementation(yuanbao(new Set(["token-a"])));
    const post = (route, body) => routes[route].POST(json(`/v1/${route}`, body));

    const message = await post("messages", { model: "ybw/hunyuan", max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    expect(message.status).toBe(200);
    expect((await message.json()).content.some((block) => block.text === "pong")).toBe(true);
    const messageStream = await (await post("messages", { model: "ybw/hunyuan", max_tokens: 16, stream: true, messages: [{ role: "user", content: "ping" }] })).text();
    expect(messageStream).toContain("event: message_start");
    expect(messageStream).toContain("event: message_stop");

    const response = await post("responses", { model: "ybw/hunyuan", input: "ping" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("pong");
    const responseStream = await (await post("responses", { model: "ybw/hunyuan", input: "ping", stream: true })).text();
    expect(responseStream).toContain("response.completed");
    expect(outbound.mock.calls.every(([url]) => String(url).startsWith("https://yuanbao.tencent.com/"))).toBe(true);
  });

  it("falls back from an expired session, keeps the sibling untouched, and recovers after re-paste", async () => {
    const expired = await addConnection("yuanbao-web", "expired", "hy_user=user-old; hy_token=token-old", 1);
    const live = await addConnection("yuanbao-web", "live", "hy_user=user-live; hy_token=token-live", 2);
    const liveBefore = await db.getProviderConnectionById(live.id);
    outbound.mockImplementation(yuanbao(new Set(["token-live"])));

    const res = await chat("ybw/hunyuan");
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("pong");
    expect(seen.map((call) => call.cookie.match(/hy_token=(.+)/)[1])).toEqual(["token-old", "token-live", "token-live"]);

    const after = await db.getProviderConnectionById(expired.id);
    expect(after.errorCode ?? after.lastErrorCode).toBeTruthy();
    expect(lockFields(after).length).toBeGreaterThan(0);
    expect(JSON.stringify(after.lastError ?? "")).not.toContain("token-old");
    const liveAfter = await db.getProviderConnectionById(live.id);
    expect(liveAfter.apiKey).toBe(liveBefore.apiKey);
    expect(lockFields(liveAfter)).toEqual([]);

    // Re-import: the dashboard Edit dialog PUTs the fresh cookie over the expired one.
    const put = await routes.provider.PUT(json(`/api/providers/${expired.id}`, { apiKey: "hy_user=user-new; hy_token=token-new", testStatus: "unknown", lastError: null, lastErrorAt: null }, "PUT"), params(expired.id));
    expect(put.status).toBe(200);
    const reimported = await db.getProviderConnectionById(expired.id);
    expect(reimported.apiKey).toBe("hy_user=user-new; hy_token=token-new");
    expect(lockFields(reimported)).toEqual([]);
    expect((await db.getProviderConnectionById(live.id)).apiKey).toBe(liveBefore.apiKey);

    seen = [];
    outbound.mockImplementation(yuanbao(new Set(["token-new", "token-live"])));
    await db.updateProviderConnection(live.id, { isActive: false });
    expect((await chat("ybw/hunyuan")).status).toBe(200);
    expect(new Set(seen.map((call) => call.cookie))).toEqual(new Set(["hy_source=web; hy_user=user-new; hy_token=token-new"]));
  });

  it.each([401, 403])("returns an actionable %i when the only session is rejected, without echoing the cookie", async (status) => {
    await addConnection("yuanbao-web", "only", "hy_user=user-old; hy_token=token-old");
    outbound.mockImplementation(async () => new Response("", { status }));
    const res = await chat("ybw/hunyuan");
    expect(res.status).toBe(status);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/expired|auth/i);
    expect(text).not.toMatch(/token-old|user-old/);
  });

  it("keeps 429 as rate limiting and rejects an incomplete saved cookie locally", async () => {
    await addConnection("yuanbao-web", "limited", COOKIE_A);
    outbound.mockImplementation(async () => new Response("", { status: 429 }));
    expect((await chat("ybw/hunyuan")).status).toBe(429);
    await routes.provider.DELETE(json("", null, "DELETE"), params((await db.getProviderConnections({ provider: "yuanbao-web" }))[0].id));

    outbound.mockClear();
    await addConnection("yuanbao-web", "half", "hy_token=token-only");
    const res = await chat("ybw/hunyuan");
    expect(res.status).toBe(401);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("does not use another Tencent provider's credential or send the cookie to it", async () => {
    await addConnection("yuanbao-web", "yb", COOKIE_A);
    outbound.mockImplementation(yuanbao(new Set(["token-a"])));
    expect((await chat("ybw/hunyuan")).status).toBe(200);
    expect(seen.every((call) => new URL(call.url).hostname === "yuanbao.tencent.com")).toBe(true);
    // A Yuanbao-shaped cookie saved under Tencent Hunyuan is never dispatched through the Yuanbao executor.
    const stray = await db.createProviderConnection({ provider: "tencent", authType: "apikey", name: "tencent", apiKey: COOKIE_A, isActive: true, priority: 1 });
    expect(stray.provider).toBe("tencent");
    seen = [];
    expect((await chat("ybw/hunyuan")).status).toBe(200);
    expect(seen.every((call) => call.cookie.includes("token-a"))).toBe(true);
  });

  it("summarises only DurinDoor's own recorded requests for a saved session", async () => {
    const mine = await addConnection("yuanbao-web", "mine", COOKIE_A, 1);
    const other = await addConnection("yuanbao-web", "other", "hy_user=user-b; hy_token=token-b", 2);
    expect((await (await usage(mine.id)).json()).message).toBe("Yuanbao Web connected. No requests recorded in the last 30 days.");
    outbound.mockImplementation(yuanbao(new Set(["token-a"]), "hello world"));
    // The chat response schedules usage persistence without awaiting it.
    const usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
    expect((await chat("ybw/hunyuan")).status).toBe(200);
    expect(usageWrite).toHaveBeenCalledOnce();
    await usageWrite.mock.results[0].value;
    expect((await (await usage(mine.id)).json()).displayMessage).toBe("Yuanbao Web connected. 1 requests in the last 30 days.");
    expect(Object.keys((await (await usage(mine.id)).json()).quotas)).toEqual(expect.arrayContaining(["Total tokens (30d)"]));
    expect((await (await usage(other.id)).json()).message).toBe("Yuanbao Web connected. No requests recorded in the last 30 days.");
  });
});

describe.each([
  ["muse-spark-web", "ms-web", "ecto_1_sess=synthetic-muse", "ecto_1_sess=fresh-muse", "ms-web/muse-spark", "https://www.meta.ai"],
  ["huggingchat", "huggingchat", "hf-chat=synthetic-hf", "hf-chat=fresh-hf", "huggingchat/Qwen/Qwen3.6-27B", "https://huggingface.co"],
])("%s saved cookie lifecycle (dispatch deliberately closed)", (provider, alias, cookie, fresh, model, origin) => {
  it("stores the cookie but never sends it: validate, test, discovery and every client entry point fail closed", async () => {
    const a = await addConnection(provider, `${provider}-a`, cookie, 1);
    const b = await addConnection(provider, `${provider}-b`, `${cookie}-b`, 2);
    expect(a).toMatchObject({ provider, authType: "cookie" });
    expect(JSON.stringify([a, b])).not.toContain("synthetic-");

    const validated = await (await routes.validate.POST(json("/api/providers/validate", { provider, apiKey: cookie }))).json();
    expect(validated).toMatchObject({ valid: false, skipped: true, error: expect.stringMatching(/not enabled/i) });
    const tested = await (await routes.test.POST(json(`/api/providers/${a.id}/test`, {}), params(a.id))).json();
    expect(tested).toMatchObject({ valid: false, skipped: true, unavailable: false });
    const stored = await db.getProviderConnectionById(a.id);
    expect(stored.testStatus ?? "unknown").not.toBe("error");
    expect(providerCalls()).toEqual([]);

    // Discovery is the static registry catalog; it does not contact the provider.
    const ids = (await modelIds()).filter((id) => id.startsWith(`${alias}/`));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain(model);
    expect(providerCalls()).toEqual([]);

    const body = { messages: [{ role: "user", content: "hello" }] };
    for (const [label, request] of [
      ["chat json", () => chat(model)],
      ["chat stream", () => chat(model, { stream: true })],
      ["messages", () => routes.messages.POST(json("/v1/messages", { model, max_tokens: 8, ...body }))],
      ["responses", () => routes.responses.POST(json("/v1/responses", { model, input: "hello" }))],
    ]) {
      const res = await request();
      expect(res.status, label).toBe(501);
      const text = await res.text();
      expect(text, label).toMatch(/not ported yet/);
      expect(text, label).not.toMatch(/synthetic-/);
    }
    expect(providerCalls()).toEqual([]);

    // Port-pending is a feature gap, not an account failure: no cooldown, no error recorded, siblings untouched.
    for (const id of [a.id, b.id]) {
      const row = await db.getProviderConnectionById(id);
      expect(lockFields(row)).toEqual([]);
      expect(row.errorCode ?? null).toBeNull();
    }
    const summary = await (await usage(a.id)).json();
    expect(summary.message).toBe("Usage not available for this connection");
    expect(providerCalls()).toEqual([]);
  });

  it("re-import replaces the saved cookie but dispatch stays closed", async () => {
    const a = await addConnection(provider, `${provider}-a`, cookie, 1);
    const put = await routes.provider.PUT(json(`/api/providers/${a.id}`, { apiKey: fresh }, "PUT"), params(a.id));
    expect(put.status).toBe(200);
    expect((await db.getProviderConnectionById(a.id)).apiKey).toBe(fresh);
    expect((await chat(model)).status).toBe(501);
    expect(providerCalls()).toEqual([]);
  });

  it("does not leak the cookie through the direct-translation entry point", async () => {
    await addConnection(provider, `${provider}-a`, cookie, 1);
    const executor = (await import("../../open-sse/executors/index.js")).getExecutor(alias);
    expect(() => executor.buildHeaders({ apiKey: cookie })).toThrow();
    expect(() => executor.buildUrl(model, true)).toThrow();
    const result = await executor.execute({ model, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: cookie } });
    expect(result.response.status).toBe(501);
    expect(result.headers).toEqual({});
    expect(JSON.stringify(result.transformedBody)).not.toContain(origin);
    expect(providerCalls()).toEqual([]);
  });
});
