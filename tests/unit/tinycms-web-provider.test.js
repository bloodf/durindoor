import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Closed mocks only: every upstream call below is answered by a synthetic fetch.
// The WASM signer and proof-of-work solver are the real vendored modules, run
// against a synthetic challenge fixture.
vi.mock("../../open-sse/providers/registry/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const provider = (await import("../../open-sse/providers/private/tinycms-web.js")).default;
  return { ...actual, default: [...actual.default, provider] };
});
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { TinyCmsExecutor } = await import("../../open-sse/executors/tinycms-web.js");
  const executor = new TinyCmsExecutor();
  return { ...actual, getExecutor: (id) => (id === "tinycms-web" ? executor : actual.getExecutor(id)) };
});
vi.mock("@/lib/usageDb.js", async (importOriginal) => ({ ...(await importOriginal()), appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), saveRequestDetail: vi.fn(() => Promise.resolve()), saveRequestUsage: vi.fn(() => Promise.resolve()) }));

const CHAT_URL = "https://gov.freegpt.win/api/openai/oneapi/v1/chat/completions";
const CHALLENGE_URL = "https://gov.freegpt.win/api/challenge";
const IP_HOST = "api64.ipify.org";
const UUID_A = "Rsynthetic-device-a";
const UUID_B = "Rsynthetic-device-b";
const UUID_EXPIRED = "Rsynthetic-device-expired";

// Synthetic stand-in for a recorded /api/challenge reply.
const CHALLENGE_FIXTURE = { challengeId: "synthetic-challenge-1", challenge: "synthetic-challenge-payload", expiresAt: 4102444800000, version: "1", difficulty: 2 };

let root, routes, handleChat, TinyCmsExecutor, validateTinyCmsSession, TINYCMS_WEB_CREDENTIAL_PROFILE, provider;
const wire = { calls: [], challenge: { ...CHALLENGE_FIXTURE }, challengeStatus: null, chatStatus: null, chatBody: null };

const request = (url, body, method = "POST") => new Request(`http://gateway.invalid${url}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
const headerOf = (init) => Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
const completion = (content) => ({ id: "chatcmpl-tinycms", object: "chat.completion", created: 1, model: "gpt-5.5", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl-tinycms", object: "chat.completion.chunk", created: 1, model: "gpt-5.5", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

const syntheticUpstream = (liveUuids) => async (url, init = {}) => {
  const target = String(url);
  const headers = headerOf(init);
  if (new URL(target).hostname === IP_HOST) return Response.json({ ip: "203.0.113.9" });
  wire.calls.push({ url: target, headers, body: init.body ? JSON.parse(init.body) : null });
  if (target === CHALLENGE_URL) {
    if (wire.challengeStatus) return new Response("challenge refused", { status: wire.challengeStatus, headers: wire.challengeStatus === 429 ? { "retry-after": "30" } : {} });
    if (!liveUuids.has(headers.uuid)) return new Response("unknown device", { status: 401 });
    return Response.json(wire.challenge);
  }
  if (target === CHAT_URL) {
    if (wire.chatStatus) return new Response("refused", { status: wire.chatStatus, headers: wire.chatStatus === 429 ? { "retry-after": "12" } : {} });
    if (!liveUuids.has(headers.uuid)) return new Response("unknown device", { status: 403 });
    if (wire.chatBody) return Response.json(wire.chatBody);
    const body = JSON.parse(init.body);
    if (body.stream) return new Response(`${chunk({ role: "assistant" })}${chunk({ content: "hel" })}${chunk({ content: "lo" })}${chunk({}, "stop")}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    return Response.json(completion("hello"));
  }
  throw new Error(`unexpected mocked URL ${target}`);
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tinycms-web-test-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data")); vi.stubEnv("HOME", path.join(root, "home")); vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true }); delete global._dbAdapter; vi.resetModules();
  Object.assign(wire, { calls: [], challenge: { ...CHALLENGE_FIXTURE }, challengeStatus: null, chatStatus: null, chatBody: null });
  vi.stubGlobal("fetch", vi.fn(syntheticUpstream(new Set([UUID_A, UUID_B]))));
  routes = { providers: await import("../../src/app/api/providers/route.js"), models: await import("../../src/app/api/v1/models/route.js"), messages: await import("../../src/app/api/v1/messages/route.js") };
  ({ TinyCmsExecutor, validateTinyCmsSession } = await import("../../open-sse/executors/tinycms-web.js"));
  ({ default: provider, TINYCMS_WEB_CREDENTIAL_PROFILE } = await import("../../open-sse/providers/private/tinycms-web.js"));
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60000);

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.(); delete global._dbAdapter;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});

const connection = async (name, apiKey) => {
  const result = await routes.providers.POST(request("/api/providers", { provider: "tinycms-web", name, apiKey }));
  expect(result.status).toBe(201);
  return (await result.json()).connection;
};
const openai = (model = "tcw/gpt-5.5", extra = {}) => handleChat(request("/v1/chat/completions", { model, messages: [{ role: "user", content: "ping" }], ...extra }));
const anthropic = (extra = {}) => routes.messages.POST(request("/v1/messages", { model: "tcw/gpt-5.5", max_tokens: 64, messages: [{ role: "user", content: "ping" }], ...extra }));
const direct = (uuid, extra = {}) => new TinyCmsExecutor().execute({ body: { model: "gpt-5.5", messages: [{ role: "user", content: "ping" }], ...extra }, stream: Boolean(extra.stream), credentials: { apiKey: uuid } });
const chatCalls = () => wire.calls.filter((call) => call.url === CHAT_URL);

describe("TinyCMS Web provider module", () => {
  it("exposes the pinned catalog, UUID credential contract and import profile", () => {
    expect(provider).toMatchObject({ id: "tinycms-web", alias: "tcw", authType: "apikey" });
    expect(provider.transport).toMatchObject({ baseUrl: CHAT_URL, executor: "tinycms-web", format: "openai" });
    expect(provider.models.map((model) => model.id)).toEqual(expect.arrayContaining(["claude-fable-5", "gpt-5.5", "mimo-v2.5"]));
    expect(provider.models).toHaveLength(22);
    expect(provider.authHint).toContain("app-config-uuid");
    expect(TINYCMS_WEB_CREDENTIAL_PROFILE).toMatchObject({ origin: "https://site.tinycms.xyz", domains: ["site.tinycms.xyz", "gov.freegpt.win"], cookieNames: [], localStorageKeys: ["app-config-uuid"] });
    expect(TINYCMS_WEB_CREDENTIAL_PROFILE.validationProbe).toMatchObject({ url: CHALLENGE_URL, method: "GET", okStatus: [200] });
    expect(new RegExp(TINYCMS_WEB_CREDENTIAL_PROFILE.credentialPattern).test(UUID_A)).toBe(true);
    expect(new RegExp(TINYCMS_WEB_CREDENTIAL_PROFILE.credentialPattern).test("abc123")).toBe(false);
  });
});

describe("TinyCMS Web validation and discovery", () => {
  it("accepts a live device UUID and rejects malformed, unknown, expired and throttled ones", async () => {
    const fetcher = (live) => vi.fn(syntheticUpstream(new Set(live)));
    await expect(validateTinyCmsSession({ apiKey: UUID_A, fetcher: fetcher([UUID_A]) })).resolves.toEqual({ valid: true, status: 200 });
    await expect(validateTinyCmsSession({ apiKey: "abc123", fetcher: fetcher([]) })).resolves.toMatchObject({ valid: false, status: 401 });
    await expect(validateTinyCmsSession({ apiKey: "", fetcher: fetcher([]) })).resolves.toMatchObject({ valid: false, status: 401 });
    await expect(validateTinyCmsSession({ apiKey: UUID_EXPIRED, fetcher: fetcher([UUID_A]) })).resolves.toMatchObject({ valid: false, status: 401 });
    wire.challengeStatus = 429;
    await expect(validateTinyCmsSession({ apiKey: UUID_A, fetcher: fetcher([UUID_A]) })).resolves.toMatchObject({ valid: false, status: 429, error: expect.stringContaining("quota") });
    wire.challengeStatus = null; wire.challenge = { nope: true };
    await expect(validateTinyCmsSession({ apiKey: UUID_A, fetcher: fetcher([UUID_A]) })).resolves.toMatchObject({ valid: false, status: 502 });
    const probe = vi.fn(syntheticUpstream(new Set([UUID_A])));
    wire.challenge = { ...CHALLENGE_FIXTURE };
    await validateTinyCmsSession({ apiKey: UUID_A, fetcher: probe });
    expect(headerOf(probe.mock.calls[0][1])).toMatchObject({ uuid: UUID_A, "x-origin": "https://gov.freegpt.win" });
  });

  it("lists the staged catalog under the tcw alias and stores the UUID as an API-key connection", async () => {
    const saved = await connection("tinycms-a", UUID_A);
    expect(saved.authType).toBe("apikey");
    const catalog = await (await routes.models.GET(request("/v1/models", null, "GET"))).json();
    expect(catalog.data.map((model) => model.id)).toEqual(expect.arrayContaining(["tcw/claude-fable-5", "tcw/gpt-5.5", "tcw/deepseek-v4-pro", "tcw/mimo-v2.5"]));
  });
});

describe("TinyCMS Web chat through the gateway routes", () => {
  it("signs the challenge and answers JSON chat on the OpenAI route", async () => {
    await connection("tinycms-a", UUID_A);
    const response = await openai();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.choices[0].message.content).toBe("hello");
    expect(payload.usage).toMatchObject({ completion_tokens: 2 });

    const [challenge] = wire.calls;
    expect(challenge.url).toBe(CHALLENGE_URL);
    expect(challenge.headers).toMatchObject({ uuid: UUID_A, "x-origin": "https://gov.freegpt.win" });
    const [chat] = chatCalls();
    expect(chat.body).toMatchObject({ model: "gpt-5.5", stream: false });
    const h = chat.headers;
    expect(h).toMatchObject({ uuid: UUID_A, accept: "application/json", "x-secure-challenge-id": CHALLENGE_FIXTURE.challengeId, "x-secure-challenge-version": "1", "x-secure-client-ip": "203.0.113.9", "x-secure-pow-difficulty": expect.any(String), "x-secure-version": expect.any(String) });
    expect(h["x-secure-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(h["x-secure-fingerprint"]).toBeTruthy();
    expect(h["x-secure-fingerprint"]).not.toBe("fp_error");
    expect(h["x-secure-nonce"]).toBe(h["x-session-id"]);
    // The proof of work was actually solved: the hash carries the demanded zeros.
    const difficulty = Number(h["x-secure-pow-difficulty"]);
    expect(difficulty).toBeGreaterThanOrEqual(CHALLENGE_FIXTURE.difficulty);
    expect(h["x-secure-pow-hash"].startsWith("0".repeat(difficulty))).toBe(true);
    expect(h["x-secure-timestamp"]).toMatch(/^\d{13}$/);
  });

  it("streams OpenAI chunks on the OpenAI route", async () => {
    await connection("tinycms-a", UUID_A);
    const response = await openai("tcw/gpt-5.5", { stream: true });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"content":"hel"');
    expect(text).toContain('"content":"lo"');
    expect(text).toContain("[DONE]");
    expect(chatCalls()[0].headers.accept).toBe("text/event-stream");
    expect(chatCalls()[0].body.stream).toBe(true);
  });

  it("serves JSON and streamed chat on the Anthropic Messages route", async () => {
    await connection("tinycms-a", UUID_A);
    const json = await anthropic();
    expect(json.status).toBe(200);
    const message = await json.json();
    expect(message).toMatchObject({ type: "message", role: "assistant" });
    expect(JSON.stringify(message.content)).toContain("hello");

    const streamed = await anthropic({ stream: true });
    expect(streamed.status).toBe(200);
    const text = await streamed.text();
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("hel");
    expect(text).toContain("message_stop");
  });

  it("maps an expired device identity to 401 on every route", async () => {
    await connection("tinycms-expired", UUID_EXPIRED);
    const openaiResult = await openai();
    expect(openaiResult.status).toBe(401);
    expect(JSON.stringify(await openaiResult.json())).not.toContain(UUID_EXPIRED);
    expect((await anthropic()).status).toBe(401);
    expect(chatCalls()).toHaveLength(0);

    // The challenge may succeed while the chat endpoint rejects the signature or identity.
    const executor = new TinyCmsExecutor();
    vi.stubGlobal("fetch", vi.fn(syntheticUpstream(new Set([UUID_A]))));
    const result = await executor.execute({ body: { model: "gpt-5.5", messages: [] }, credentials: { apiKey: UUID_A } });
    expect(result.response.status).toBe(200);
    wire.chatStatus = 403;
    const rejected = await direct(UUID_A);
    expect(rejected.response.status).toBe(401);
    const body = await rejected.response.json();
    expect(body.error).toMatchObject({ type: "authentication_error", code: "invalid_session" });
    expect(body.error.message).toContain("app-config-uuid");
  });

  it("maps quota responses to 429 with the retry hint", async () => {
    wire.chatStatus = 429;
    const throttled = await direct(UUID_A);
    expect(throttled.response.status).toBe(429);
    expect(throttled.response.headers.get("retry-after")).toBe("12");
    expect((await throttled.response.json()).error).toMatchObject({ type: "rate_limit_error", code: "quota_exceeded" });

    wire.chatStatus = null; wire.challengeStatus = 429;
    const early = await direct(UUID_A);
    expect(early.response.status).toBe(429);
    expect(early.response.headers.get("retry-after")).toBe("30");
    expect(chatCalls()).toHaveLength(1);

    await connection("tinycms-a", UUID_A);
    wire.challengeStatus = null; wire.chatStatus = 429;
    expect((await openai()).status).toBe(429);
    expect((await anthropic()).status).toBe(429);
  });

  it("treats a 200 error envelope as a failure and passes through ordinary JSON", async () => {
    wire.chatBody = { error: { message: "daily quota exhausted", code: 429 } };
    const failed = await direct(UUID_A);
    expect(failed.response.status).toBe(429);
    wire.chatBody = completion("fine");
    const ok = await direct(UUID_A);
    expect(ok.response.status).toBe(200);
    expect((await ok.response.json()).choices[0].message.content).toBe("fine");
  });

  it("keeps two connections isolated: each signs and sends only its own device UUID", async () => {
    await connection("tinycms-a", UUID_A);
    const first = await direct(UUID_A);
    const second = await direct(UUID_B);
    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    const identities = wire.calls.filter((call) => call.url === CHALLENGE_URL || call.url === CHAT_URL).map((call) => call.headers.uuid);
    expect(identities).toEqual([UUID_A, UUID_A, UUID_B, UUID_B]);
    const [chatA, chatB] = chatCalls();
    expect(chatA.headers.userid).toBe(UUID_A.slice(0, 20));
    expect(chatB.headers.userid).toBe(UUID_B.slice(0, 20));
    expect(chatA.headers["x-secure-signature"]).not.toBe(chatB.headers["x-secure-signature"]);
    expect(chatA.headers["x-secure-nonce"]).not.toBe(chatB.headers["x-secure-nonce"]);
    for (const call of chatCalls()) expect(JSON.stringify(call)).not.toContain(call.headers.uuid === UUID_A ? UUID_B : UUID_A);

    // An expired identity does not poison the live one.
    expect((await direct(UUID_EXPIRED)).response.status).toBe(401);
    expect((await direct(UUID_A)).response.status).toBe(200);
  });
});

describe("TinyCMS Web executor guards", () => {
  it("rejects a missing or non-R UUID before any network call", async () => {
    for (const apiKey of [undefined, "", "abc123", "R"]) {
      const result = await direct(apiKey);
      expect(result.response.status).toBe(401);
      expect((await result.response.json()).error.message).toContain("device UUID");
    }
    expect(wire.calls).toHaveLength(0);
  });

  it("fails closed on a malformed or too-hard challenge instead of sending an unsigned request", async () => {
    wire.challenge = { challengeId: "x" };
    expect((await direct(UUID_A)).response.status).toBe(502);
    wire.challenge = { ...CHALLENGE_FIXTURE, difficulty: 9 };
    const hard = await direct(UUID_A);
    expect(hard.response.status).toBe(502);
    expect((await hard.response.json()).error.message).toContain("difficulty");
    expect(chatCalls()).toHaveLength(0);
  });

  it("lets the signer install DOM stubs only for the synchronous call", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect((await direct(UUID_A)).response.status).toBe(200);
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    // The canvas fingerprint stays valid on later calls, not only the first.
    await direct(UUID_A); await direct(UUID_A);
    for (const call of chatCalls()) expect(call.headers["x-secure-fingerprint"]).not.toBe("fp_error");
  });

  it("surfaces network failure without leaking internals", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => { if (new URL(String(url)).hostname === IP_HOST) return Response.json({ ip: "203.0.113.9" }); throw new Error("connect ECONNREFUSED 10.0.0.1:443 at /srv/secret.js"); }));
    const result = await direct(UUID_A);
    expect(result.response.status).toBe(502);
    const message = (await result.response.json()).error.message;
    expect(message).not.toContain("ECONNREFUSED");
    expect(message).not.toContain("/srv/");
  });
});
