// Tencent AI Studio Web. Every upstream call is a local mock: no Tencent
// account, cookie or network request is involved. The staged provider and its
// executor are composed into the registry and executor map with vi.mock, so
// the OpenAI chat route and the Anthropic Messages route dispatch normally.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({ calls: [], mode: "json" }));
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const provider = (await import("../../open-sse/providers/private/tencent-aistudio-web.js")).default;
  return { ...actual, default: [...actual.default, provider] };
});
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { TencentAIStudioWebExecutor } = await import("../../open-sse/executors/tencent-aistudio-web.js");
  const executor = new TencentAIStudioWebExecutor();
  return { ...actual, getExecutor: (id) => (id === "tencent-aistudio-web" ? executor : actual.getExecutor(id)) };
});
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));

const ORIGIN = "https://aistudio.tencent.ai";
const LIVE = new Set(["sessionid=alpha", "sessionid=beta"]);
const completion = (content) => ({ id: "chatcmpl-synthetic", object: "chat.completion", created: 1, model: "HunyuanDefault", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const sse = (...parts) => `${parts.map((part, i) => `data: ${JSON.stringify({ id: "chatcmpl-synthetic", object: "chat.completion.chunk", created: 1, model: "HunyuanDefault", choices: [{ index: 0, delta: { content: part }, finish_reason: i === parts.length - 1 ? "stop" : null }] })}\n\n`).join("")}data: [DONE]\n\n`;

let root, routes, handleChat, executorModule, providerModule;
const request = (url, body, method = "POST") => new Request(`http://gateway.invalid${url}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
const connection = async (name, apiKey) => {
  const result = await routes.providers.POST(request("/api/providers", { provider: "tencent-aistudio-web", name, apiKey }));
  expect(result.status).toBe(201);
  return (await result.json()).connection;
};
// The mocked upstream: answers only for a live cookie and records every call.
const upstream = async (url, init) => {
  const cookie = init.headers.cookie ?? init.headers.Cookie;
  wire.calls.push({ url: String(url), method: init.method, cookie, accept: init.headers.accept, body: init.body && JSON.parse(init.body) });
  if (!LIVE.has(cookie)) return new Response("expired", { status: 401 });
  if (String(url) === `${ORIGIN}/api/user/info`) return Response.json({ uid: "synthetic" });
  if (String(url).startsWith(`${ORIGIN}/api/chat/`)) {
    if (wire.mode === "quota") return new Response("busy", { status: 429, headers: { "retry-after": "7" } });
    if (wire.mode === "sse-always") return new Response(sse("hel", "lo"), { headers: { "content-type": "text/event-stream" } });
    if (wire.mode === "json-always") return Response.json(completion("hello"));
    return init.headers.accept === "text/event-stream" ? new Response(sse("hel", "lo"), { headers: { "content-type": "text/event-stream" } }) : Response.json(completion("hello"));
  }
  throw new Error(`unexpected mocked URL ${url}`);
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tencent-aistudio-web-test-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("HOME", path.join(root, "home")); vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true }); delete global._dbAdapter; vi.resetModules();
  wire.calls = []; wire.mode = "json";
  vi.stubGlobal("fetch", vi.fn(upstream));
  routes = { providers: await import("../../src/app/api/providers/route.js"), models: await import("../../src/app/api/v1/models/route.js"), messages: await import("../../src/app/api/v1/messages/route.js") };
  executorModule = await import("../../open-sse/executors/tencent-aistudio-web.js");
  providerModule = await import("../../open-sse/providers/private/tencent-aistudio-web.js");
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.(); delete global._dbAdapter;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});

const openai = (model = "tasw/hy3-g", extra = {}) => handleChat(request("/v1/chat/completions", { model, messages: [{ role: "user", content: "ping" }], ...extra }));
const anthropic = (extra = {}) => routes.messages.POST(request("/v1/messages", { model: "tasw/hy3-g", max_tokens: 64, messages: [{ role: "user", content: "ping" }], ...extra }));
const chatCalls = () => wire.calls.filter((call) => call.url.startsWith(`${ORIGIN}/api/chat/`));

describe("Tencent AI Studio Web cookie profile and discovery", () => {
  it("exports a capture profile whose origin, domains and probe agree with the executor", () => {
    const { cookieCaptureProfile, default: provider } = providerModule;
    expect(cookieCaptureProfile).toMatchObject({ origin: ORIGIN, domains: ["aistudio.tencent.ai"], cookieNames: ["sessionid"] });
    expect(cookieCaptureProfile.validationProbe).toMatchObject({ url: executorModule.TENCENT_AISTUDIO_PROBE_URL, method: "GET", okStatus: [200] });
    expect(provider).toMatchObject({ id: "tencent-aistudio-web", alias: "tasw", category: "webCookie", authType: "cookie" });
    expect(provider.cookieImport).toMatchObject({ origin: ORIGIN, extensionCapture: true });
    expect(provider.transport).toMatchObject({ executor: "tencent-aistudio-web", format: "openai", authType: "cookie" });
  });

  it("is importable through the cookie import contract and drops unapproved cookies", async () => {
    const { getCookieImportContract, buildImportedCookieHeader } = await import("../../src/lib/providers/cookieImport/contract.js");
    const contract = getCookieImportContract("tencent-aistudio-web");
    expect(contract).toMatchObject({ origin: ORIGIN, host: "aistudio.tencent.ai", cookieNames: ["sessionid"] });
    expect(buildImportedCookieHeader(contract, [{ name: "sessionid", value: "alpha", domain: "aistudio.tencent.ai" }])).toEqual({ ok: true, header: "sessionid=alpha" });
    expect(buildImportedCookieHeader(contract, [{ name: "tracker", value: "x" }])).toMatchObject({ ok: false });
    expect(buildImportedCookieHeader(contract, [{ name: "sessionid", value: "alpha", expirationDate: 1 }])).toEqual({ ok: false, error: "Cookie is expired" });
  });

  it("lists the three models in the gateway catalog", async () => {
    await connection("tencent-a", "sessionid=alpha");
    const catalog = await (await routes.models.GET(request("/v1/models", null, "GET"))).json();
    expect(catalog.data.map((model) => model.id)).toEqual(expect.arrayContaining(["tasw/hy3-g", "tasw/hunyuan-default", "tasw/hunyuan-3d"]));
  });
});

describe("Tencent AI Studio Web cookie validation", () => {
  const validate = (apiKey, fetcher) => executorModule.validateTencentAIStudioSession({ apiKey, fetcher });

  it("accepts a live session, with or without a pasted Cookie: prefix", async () => {
    expect(await validate("sessionid=alpha", upstream)).toEqual({ valid: true, status: 200 });
    expect(await validate("Cookie: sessionid=alpha", upstream)).toEqual({ valid: true, status: 200 });
    expect(wire.calls[0]).toMatchObject({ url: `${ORIGIN}/api/user/info`, method: "GET", cookie: "sessionid=alpha" });
  });

  it("reports an expired session, a sign-in redirect and an empty paste", async () => {
    expect(await validate("sessionid=stale", upstream)).toMatchObject({ valid: false, status: 401, expired: true });
    expect(await validate("sessionid=alpha", async () => new Response(null, { status: 302, headers: { location: "/login" } }))).toMatchObject({ valid: false, expired: true });
    expect(await validate("", upstream)).toMatchObject({ valid: false, status: null });
    expect(await validate("not-a-cookie", upstream)).toMatchObject({ valid: false, status: null });
    expect(wire.calls).toHaveLength(1); // only the stale probe reached the wire
  });

  it("treats 429 and network failure as unavailable rather than as a bad cookie", async () => {
    expect(await validate("sessionid=alpha", async () => new Response("slow down", { status: 429 }))).toMatchObject({ valid: false, status: 429, rateLimited: true, unavailable: true });
    expect(await validate("sessionid=alpha", async () => { throw new Error("offline"); })).toMatchObject({ valid: false, status: null, unavailable: true });
  });
});

describe("Tencent AI Studio Web chat through the gateway routes", () => {
  it("serves JSON and streamed chat on the OpenAI chat route", async () => {
    await connection("tencent-a", "sessionid=alpha");
    const json = await openai();
    expect(json.status).toBe(200);
    const payload = await json.json();
    expect(payload.choices[0].message.content).toBe("hello");
    expect(payload.usage).toMatchObject({ completion_tokens: 2 });
    const stream = await (await openai("tasw/hy3-g", { stream: true })).text();
    expect(stream).toContain('"content":"hel"'); expect(stream).toContain('"content":"lo"'); expect(stream).toContain("[DONE]");
    const [first, second] = chatCalls();
    expect(first).toMatchObject({ url: `${ORIGIN}/api/chat/HunyuanDefault`, method: "POST", cookie: "sessionid=alpha", accept: "application/json" });
    expect(first.body).toMatchObject({ model: "HunyuanDefault", messages: [{ role: "user", content: "ping" }], stream: false });
    expect(second).toMatchObject({ accept: "text/event-stream", body: { stream: true } });
  });

  it("maps model ids to the Tencent model names", async () => {
    await connection("tencent-a", "sessionid=alpha");
    await openai("tasw/hunyuan-3d");
    expect(chatCalls()[0].url).toBe(`${ORIGIN}/api/chat/Hunyuan3D`);
  });

  it("serves JSON and streamed chat on the Anthropic Messages route", async () => {
    await connection("tencent-a", "sessionid=alpha");
    const json = await anthropic();
    expect(json.status).toBe(200);
    const message = await json.json();
    expect(message).toMatchObject({ type: "message", role: "assistant" });
    expect(JSON.stringify(message.content)).toContain("hello");
    const stream = await anthropic({ stream: true });
    expect(stream.status).toBe(200);
    const text = await stream.text();
    expect(text).toContain("event: content_block_delta"); expect(text).toContain("hel"); expect(text).toContain("message_stop");
    expect(chatCalls().map((call) => call.cookie)).toEqual(["sessionid=alpha", "sessionid=alpha"]);
  });

  it("reshapes an upstream that ignores the requested JSON or SSE shape", async () => {
    await connection("tencent-a", "sessionid=alpha");
    wire.mode = "sse-always";
    const folded = await (await openai()).json();
    expect(folded.choices[0].message.content).toBe("hello");
    expect(folded.usage).toBeUndefined();
    wire.mode = "json-always";
    const framed = await (await openai("tasw/hy3-g", { stream: true })).text();
    expect(framed).toContain('"content":"hello"'); expect(framed).toContain("[DONE]");
  });

  it("maps an expired session to 401 on both routes without leaking the cookie", async () => {
    await connection("tencent-expired", "sessionid=stale");
    const chat = await openai();
    expect(chat.status).toBe(401);
    expect(JSON.stringify(await chat.json())).not.toContain("stale");
    expect((await anthropic()).status).toBe(401);
  });

  it("maps a 429 to a rate limit on both routes", async () => {
    await connection("tencent-a", "sessionid=alpha");
    wire.mode = "quota";
    const chat = await openai();
    expect(chat.status).toBe(429);
    expect((await chat.json()).error.message).toMatch(/rate limit/i);
    expect((await anthropic()).status).toBe(429);
  });

  it("keeps two connections on their own cookies", async () => {
    const executor = new executorModule.TencentAIStudioWebExecutor();
    const input = (apiKey) => ({ model: "hy3-g", body: { messages: [{ role: "user", content: "ping" }] }, credentials: { apiKey }, stream: false });
    const [a, b] = [await executor.execute(input("sessionid=alpha")), await executor.execute(input("Cookie: sessionid=beta"))];
    expect(a.response.status).toBe(200); expect(b.response.status).toBe(200);
    expect(wire.calls.map((call) => call.cookie)).toEqual(["sessionid=alpha", "sessionid=beta"]);
    expect(a.headers.cookie).toBe("[REDACTED]");
    const missing = await executor.execute({ model: "hy3-g", body: {}, credentials: {} });
    expect(missing.response.status).toBe(401);
    expect(wire.calls).toHaveLength(2);
  });

  it("sends each stored connection only its own cookie and fails over past an expired one", async () => {
    await connection("tencent-expired", "sessionid=stale");
    await connection("tencent-b", "sessionid=beta");
    const response = await openai();
    expect(response.status).toBe(200);
    const cookies = chatCalls().map((call) => call.cookie);
    expect(cookies).toContain("sessionid=beta");
    // Nothing but a stored credential ever reaches the wire, one cookie per request.
    expect(cookies.every((cookie) => ["sessionid=stale", "sessionid=beta"].includes(cookie))).toBe(true);
    expect(chatCalls().every((call) => !call.cookie.includes(";"))).toBe(true);
  });
});
