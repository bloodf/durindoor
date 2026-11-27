// Venice Web, registered. Closed mocks only: every send is answered below, an
// unknown URL fails the test, and every cookie and token is synthetic. Passing
// here says nothing about the live service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const staged = vi.hoisted(() => ({ executor: null }));

// The executor map registers this provider (asserted below); the gateway tests swap in a fresh
// instance per test so the per-account discovery and session caches never cross tests.
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getExecutor: (id) => (id === "venice-web" ? staged.executor : actual.getExecutor(id)) };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import provider, { VENICE_WEB_CHAT_URL, VENICE_WEB_CLIENT_URL, VENICE_WEB_MODELS, veniceWebCookieProfile, veniceWebTokenUrl } from "../../open-sse/providers/registry/venice-web.js";
import { VeniceWebExecutor, discoverVeniceWebModels, validateVeniceWebSession } from "../../open-sse/executors/venice-web.js";
import { readVeniceWebCredential } from "../../open-sse/executors/venice-web/credential.js";
import { createVeniceSessions } from "../../open-sse/executors/venice-web/session.js";
import { cookieDomainAllowed, cookieImportConfig, isApprovedCookieName, resolveCookieImportContract } from "../../src/shared/utils/cookieImportContract.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { REGISTERED_EXECUTOR_IDS, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { saveRequestUsage } from "@/lib/usageDb.js";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims, signature = "synthetic-signature") => `${encode({ alg: "RS256", typ: "JWT", kid: "synthetic-shared-key-id" })}.${encode(claims)}.${signature}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

// Both cookies share the JWT header, so any prefix-based key would mix them up.
const CLIENT_A = jwt({ id: "client_synthetic_a" }, "signature-a");
const CLIENT_B = jwt({ id: "client_synthetic_b" }, "signature-b");
const ACCOUNTS = new Map([
  [CLIENT_A, { sessionId: "sess_a", userId: "user_synthetic_a" }],
  [CLIENT_B, { sessionId: "sess_b", userId: "user_synthetic_b" }],
]);
const sessionToken = (userId, ttlSeconds = 3600) => jwt({ sub: userId, exp: nowSeconds() + ttlSeconds, nonce: Math.random() });

const ndjson = (...events) => events.map((event) => `${typeof event === "string" ? event : JSON.stringify(event)}\n`).join("");
const text = (content) => ({ kind: "content", content });
const META = { kind: "meta", completion_id: "synthetic" };
const venice = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
const chunked = (...chunks) => new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
const LEAK = "upstream-secret-detail";

const wire = { calls: [], issued: [], lookup: null, mint: null, chat: null, followed: [] };

const clientCookieOf = (init) => init.headers.Cookie?.replace(/^__client=/, "");
const defaults = {
  lookup: (init) => {
    const account = ACCOUNTS.get(clientCookieOf(init));
    if (!account) return new Response(LEAK, { status: 401 });
    return Response.json({ response: { sessions: [{ id: "sess_old", status: "ended" }, { id: account.sessionId, status: "active" }] } });
  },
  mint: (init, url) => {
    const account = ACCOUNTS.get(clientCookieOf(init));
    if (!account || url !== veniceWebTokenUrl(account.sessionId)) return new Response(LEAK, { status: 401 });
    const token = sessionToken(account.userId);
    wire.issued.push({ token, userId: account.userId });
    return Response.json({ jwt: token });
  },
  chat: () => venice(ndjson(text("Hello "), "not-json", text("there"), META)),
};

const routeOf = (url, method) => {
  if (url === VENICE_WEB_CLIENT_URL && method === "GET") return "lookup";
  if (/^https:\/\/clerk\.venice\.ai\/v1\/client\/sessions\/sess_[ab]\/tokens$/.test(url) && method === "POST") return "mint";
  if (url === VENICE_WEB_CHAT_URL && method === "POST") return "chat";
  return null;
};

const upstream = vi.fn(async (url, init = {}) => {
  const target = String(url);
  wire.calls.push({ url: target, init });
  const route = routeOf(target, init.method ?? "GET");
  if (!route) throw new Error(`unexpected mocked URL ${target}`);
  const response = await (wire[route] ?? defaults[route])(init, target);
  // Like fetch: a followed redirect would carry the credential to the new host.
  if (response.status >= 300 && response.status < 400 && init.redirect !== "manual") {
    if (init.redirect === "error") throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    wire.followed.push({ to: response.headers.get("location"), headers: init.headers });
  }
  return response;
});

let restoreOriginalFetch;
beforeEach(async () => {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
  restoreOriginalFetch = __setOriginalFetchForTesting(upstream);
  vi.stubGlobal("fetch", upstream);
  Object.assign(wire, { calls: [], issued: [], lookup: null, mint: null, chat: null, followed: [] });
  staged.executor = new VeniceWebExecutor();
  vi.mocked(saveRequestUsage).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  restoreOriginalFetch();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const credential = (clientJwt = CLIENT_A) => ({ apiKey: `__client=${clientJwt}` });
const run = ({ model = "venice-uncensored", stream = false, credentials = credential(), body = {}, executor = staged.executor, signal } = {}) =>
  executor.execute({ model, stream, credentials, signal, body: { model, messages: [{ role: "user", content: "ping" }], ...body } });
const kinds = () => wire.calls.map((call) => routeOf(call.url, call.init.method ?? "GET"));
const callsOf = (route) => wire.calls.filter((call) => routeOf(call.url, call.init.method ?? "GET") === route);
const sseData = (raw) => raw.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)));
const errorOf = async (result) => (await result.response.json()).error;

describe("registered Venice Web provider module", () => {
  it("is a registry entry with its own executor and is no longer staged", () => {
    expect(REGISTRY).toContain(provider);
    expect(REGISTERED_EXECUTOR_IDS).toEqual(expect.arrayContaining(["venice-web", "venw"]));
    expect(hasSpecializedExecutor("venice-web")).toBe(true);
    expect(STAGED_PROVIDERS["venice-web"]).toBeUndefined();
  });

  it("is a cookie identity separate from the Venice API-key provider", () => {
    expect(provider).toMatchObject({ id: "venice-web", alias: "venw", category: "webCookie", authType: "cookie", transport: { baseUrl: VENICE_WEB_CHAT_URL, executor: "venice-web", authType: "cookie" } });
    const apiKeyProvider = REGISTRY.find((entry) => entry.id === "venice");
    expect(apiKeyProvider).toMatchObject({ category: "apikey", transport: { baseUrl: "https://api.venice.ai/api/v1/chat/completions" } });
    // Holds before and after registration: no other entry may claim these names.
    const taken = REGISTRY.filter((entry) => entry.id !== provider.id).flatMap((entry) => [entry.id, entry.alias, entry.uiAlias, ...(entry.aliases ?? [])]);
    expect(taken).not.toContain(provider.id);
    expect(taken).not.toContain(provider.alias);
    expect(provider.models.map((model) => model.id)).toEqual(["venice-uncensored", "llama-3.3-70b", "qwen3-235b", "qwen3-4b", "deepseek-r1-671b"]);
    expect(provider.models.every((model) => model.toolCalling === false)).toBe(true);
  });

  it("imports and captures only the __client cookie of clerk.venice.ai, without an account email or web login", () => {
    const contract = resolveCookieImportContract(cookieImportConfig(provider));
    expect(contract).toMatchObject({ origin: "https://clerk.venice.ai", cookieNames: ["__client"], cookiePrefixes: [], extensionCapture: true });
    expect(contract.accountEmail).toBeUndefined();
    expect(isApprovedCookieName(contract, "__client")).toBe(true);
    for (const name of ["__session", "__client_uat", "__client.0"]) expect(isApprovedCookieName(contract, name)).toBe(false);
    expect(cookieDomainAllowed(contract.host, ".clerk.venice.ai")).toBe(true);
    for (const domain of ["api.venice.ai", "outerface.venice.ai", "example.com"]) expect(cookieDomainAllowed(contract.host, domain)).toBe(false);
    expect(veniceWebCookieProfile.extensionCapture).toBeUndefined();
    expect(provider.webLogin).toBeUndefined();
  });
});

describe("Venice Web credential", () => {
  it.each([
    CLIENT_A,
    `__client=${CLIENT_A}`,
    `  __client=${CLIENT_A};\n`,
    `Cookie: __client_uat=123; __client=${CLIENT_A}; theme=dark`,
  ])("takes exactly the __client value (form %#)", (apiKey) => {
    expect(readVeniceWebCredential({ apiKey })).toEqual({ clientJwt: CLIENT_A });
  });

  it.each([
    ["nothing", {}],
    ["an empty string", { apiKey: "   " }],
    ["a non-string", { apiKey: { __client: CLIENT_A } }],
    ["an API key", { apiKey: "VENICE_INFERENCE_KEY_synthetic1234567890" }],
    ["an sk- key", { apiKey: "sk-synthetic-key" }],
    ["another cookie name", { apiKey: `__session=${CLIENT_A}` }],
    ["a look-alike cookie name", { apiKey: `__client_uat=${CLIENT_A}` }],
    ["two __client cookies", { apiKey: `__client=${CLIENT_A}; __client=${CLIENT_B}` }],
    ["a header break", { apiKey: `__client=${CLIENT_A}\r\nX-Injected: 1` }],
    ["a value with a space", { apiKey: `${CLIENT_A} extra` }],
    ["two segments", { apiKey: "eyJhbGciOiJub25lIn0.eyJpZCI6IngifQ" }],
    ["an unreadable payload", { apiKey: "eyJhbGciOiJub25lIn0.bm90LWpzb24.signature" }],
    ["an array payload", { apiKey: jwt([1]) }],
    ["an oversized token", { apiKey: jwt({ pad: "x".repeat(9000) }) }],
    ["only an access token", { accessToken: CLIENT_A }],
    ["only provider-specific data", { providerSpecificData: { cookie: `__client=${CLIENT_A}`, __client: CLIENT_A } }],
  ])("refuses %s before any send", async (_name, credentials) => {
    const result = await run({ credentials });
    expect(result.response.status).toBe(401);
    expect(await errorOf(result)).toMatchObject({ code: "invalid_credential", type: "authentication_error" });
    expect(wire.calls).toHaveLength(0);
  });

  it("reports an expired cookie JWT without a send", async () => {
    const result = await run({ credentials: { apiKey: jwt({ id: "client_old", exp: nowSeconds() - 5 }) } });
    expect(result.response.status).toBe(401);
    expect((await errorOf(result)).code).toBe("session_expired");
    expect(wire.calls).toHaveLength(0);
  });
});

describe("Venice Web wire contract", () => {
  it("sends the cookie to Clerk only, then the session token to the inference URL only", async () => {
    const before = Date.now();
    const result = await run({ credentials: { apiKey: `__client_uat=1; __client=${CLIENT_A}; other=secret` }, body: { temperature: 0.2, top_p: 0.5, max_tokens: 9 } });
    expect(result.response.status).toBe(200);
    expect(wire.calls.map((call) => [call.init.method, call.url, call.init.redirect])).toEqual([
      ["GET", "https://clerk.venice.ai/v1/client", "manual"],
      ["POST", "https://clerk.venice.ai/v1/client/sessions/sess_a/tokens", "manual"],
      ["POST", "https://outerface.venice.ai/api/inference/chat", "manual"],
    ]);
    const [lookup, mint, chat] = wire.calls;
    const userAgent = lookup.init.headers["User-Agent"];
    const clerk = { Cookie: `__client=${CLIENT_A}`, "Content-Type": "application/json", "User-Agent": userAgent, Origin: "https://venice.ai" };
    expect(lookup.init.headers).toEqual(clerk);
    expect(mint.init.headers).toEqual(clerk);
    expect(lookup.init.body).toBeUndefined();
    expect(mint.init.body).toBeUndefined();

    const token = wire.issued[0].token;
    expect(chat.init.headers).toEqual({
      "Content-Type": "application/json", "User-Agent": userAgent, Accept: "*/*", Referer: "https://venice.ai/", Origin: "https://venice.ai",
      Authorization: `Bearer ${token}`, "x-venice-request-timestamp-ms": expect.stringMatching(/^\d+$/), "x-venice-version": "interface@web", "x-venice-middleface-version": "outerface@web",
    });
    expect(Number(chat.init.headers["x-venice-request-timestamp-ms"])).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(chat.init)).not.toContain(CLIENT_A);
    const envelope = JSON.parse(chat.init.body);
    expect(envelope).toEqual({
      modelId: "venice-uncensored", prompt: [{ role: "user", content: "ping" }], reasoning: false, temperature: 0.2, topP: 0.5,
      requestId: expect.stringMatching(/^[0-9a-z]{7}$/), userId: "user_synthetic_a", simpleMode: false, includeVeniceSystemPrompt: false,
      webEnabled: false, webScrapeEnabled: false, xSearchEnabled: false, conversationType: "text", enableLargeContextChat: false,
      isCharacter: false, clientProcessingTime: 0,
    });

    // What the gateway may log carries no credential or account id.
    expect(result.url).toBe(VENICE_WEB_CHAT_URL);
    expect(result.headers.Authorization).toBe("[REDACTED]");
    expect(result.transformedBody.userId).toBe("[REDACTED]");
    const logged = JSON.stringify({ headers: result.headers, body: result.transformedBody });
    for (const secret of [token, CLIENT_A, "user_synthetic_a"]) expect(logged).not.toContain(secret);
  });

  it("maps messages and default sampling, and strips only its own model prefix", async () => {
    await run({
      model: "venw/vendor/custom-model",
      body: {
        tools: [{ type: "function", function: { name: "unused" } }], tool_choice: "none",
        messages: [
          { role: "developer", content: "rules" },
          { role: "user", content: [{ type: "text", text: "first " }, { type: "input_text", text: "part" }] },
          { role: "assistant", content: "answer" },
          { role: "assistant", content: null },
          { role: "user", content: "second" },
        ],
      },
    });
    const envelope = JSON.parse(callsOf("chat")[0].init.body);
    expect(envelope).toMatchObject({ modelId: "vendor/custom-model", temperature: 0.7, topP: 0.9 });
    expect(envelope.prompt).toEqual([
      { role: "system", content: "rules" }, { role: "user", content: "first part" },
      { role: "assistant", content: "answer" }, { role: "user", content: "second" },
    ]);
  });

  it.each([
    ["no messages", { messages: [] }],
    ["no user text", { messages: [{ role: "system", content: "only" }] }],
    ["an image part", { messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:" } }] }] }],
    ["a tool result", { messages: [{ role: "user", content: "x" }, { role: "tool", content: "result" }] }],
    ["a tool call", { messages: [{ role: "user", content: "x" }, { role: "assistant", content: null, tool_calls: [{ id: "1" }] }] }],
    ["offered tools", { tools: [{ type: "function", function: { name: "lookup" } }] }],
    ["offered functions", { functions: [{ name: "lookup" }] }],
  ])("refuses %s before any send instead of dropping it", async (_name, body) => {
    const result = await run({ body });
    expect(result.response.status).toBe(400);
    expect((await errorOf(result)).code).toBe("invalid_request");
    expect(wire.calls).toHaveLength(0);
  });

  it("refuses a missing model before any send", async () => {
    const result = await staged.executor.execute({ model: "venice-web/", stream: false, credentials: credential(), body: { messages: [{ role: "user", content: "ping" }] } });
    expect(result.response.status).toBe(400);
    expect(wire.calls).toHaveLength(0);
  });

  it("ignores connection settings that try to move a destination, and exposes no credential as metadata", async () => {
    const moved = { ...credential(), providerSpecificData: { baseUrl: "https://attacker.invalid", clerkUrl: "https://attacker.invalid" } };
    expect((await run({ credentials: moved })).response.status).toBe(200);
    expect(new Set(wire.calls.map((call) => new URL(call.url).host))).toEqual(new Set(["clerk.venice.ai", "outerface.venice.ai"]));
    expect(staged.executor.buildUrl("venice-uncensored", false, 0, moved)).toBe(VENICE_WEB_CHAT_URL);
    expect(staged.executor.buildHeaders(moved)).toEqual({});
  });
});

describe("Venice Web model discovery", () => {
  it("returns the static list after one read-only session lookup with the selected cookie", async () => {
    const models = await discoverVeniceWebModels({ credentials: credential(CLIENT_B) });
    expect(models).toEqual(VENICE_WEB_MODELS.map((model) => ({ ...model })));
    expect(kinds()).toEqual(["lookup"]);
    expect(wire.calls[0].init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(wire.calls[0].init.headers.Cookie).toBe(`__client=${CLIENT_B}`);
    // Callers cannot edit the shared catalog.
    models[0].id = "changed";
    expect(VENICE_WEB_MODELS[0].id).toBe("venice-uncensored");
  });

  it("uses only the supplied fetcher, proxy settings and signal", async () => {
    const fetcher = vi.fn(async (_url, init) => defaults.lookup(init));
    const proxyOptions = { strictProxy: true };
    const signal = new AbortController().signal;
    await discoverVeniceWebModels({ credentials: credential(), fetcher, proxyOptions, signal });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([VENICE_WEB_CLIENT_URL, expect.objectContaining({ signal, redirect: "manual" }), proxyOptions]);
    expect(wire.calls).toHaveLength(0);
  });

  it("sends nothing for an API key", async () => {
    await expect(discoverVeniceWebModels({ credentials: { apiKey: "sk-synthetic" } })).rejects.toMatchObject({ status: 401, code: "invalid_credential" });
    expect(wire.calls).toHaveLength(0);
  });

  it("lists nothing for a rejected session", async () => {
    wire.lookup = () => Response.json({ response: { sessions: [{ id: "sess_a", status: "expired" }] } });
    await expect(discoverVeniceWebModels({ credentials: credential() })).rejects.toMatchObject({ status: 401, code: "session_expired" });
    expect(kinds()).toEqual(["lookup"]);
  });

  it.each([
    ["a live session", null, { valid: true, status: 200 }],
    ["a rejected cookie", () => new Response(LEAK, { status: 401 }), { valid: false, status: 401, expired: true }],
    ["a rate limit", () => new Response(LEAK, { status: 429 }), { valid: false, status: 429, unavailable: true }],
    ["a Clerk outage", () => new Response(LEAK, { status: 503 }), { valid: false, status: 503, unavailable: true }],
    ["a network failure", () => { throw new TypeError(LEAK); }, { valid: false, status: 502, unavailable: true }],
  ])("validates %s with that single GET", async (_name, route, expected) => {
    wire.lookup = route;
    const verdict = await validateVeniceWebSession({ apiKey: `__client=${CLIENT_A}` });
    expect(verdict).toMatchObject(expected);
    if (!expected.expired) expect(verdict.expired).toBeUndefined();
    expect(JSON.stringify(verdict)).not.toContain(LEAK);
    expect(kinds()).toEqual(["lookup"]);
  });
});

describe("Venice Web replies", () => {
  it("folds events into one JSON completion and reports no usage", async () => {
    wire.chat = () => venice(ndjson({ kind: "content", reasoning_content: "think" }, text("Hello "), "not-json", "[1]", { kind: "meta", content: "ignored" }, text("there"), META));
    const result = await run();
    expect(result.response.headers.get("content-type")).toContain("application/json");
    const body = await result.response.json();
    expect(body).toMatchObject({ object: "chat.completion", model: "venice-uncensored", choices: [{ index: 0, message: { role: "assistant", content: "Hello there", reasoning_content: "think" }, finish_reason: "stop" }] });
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.usage).toBeUndefined();
  });

  it("streams role, deltas, one stop and [DONE]", async () => {
    wire.chat = () => venice(ndjson({ kind: "content", reasoning_content: "think" }, text("Hel"), text("lo"), META));
    const result = await run({ stream: true });
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    const raw = await result.response.text();
    const chunks = sseData(raw);
    expect(chunks.map((chunk) => [chunk.choices[0].delta, chunk.choices[0].finish_reason])).toEqual([
      [{ role: "assistant", content: "" }, null], [{ reasoning_content: "think" }, null], [{ content: "Hel" }, null], [{ content: "lo" }, null], [{}, "stop"],
    ]);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
    expect(chunks.every((chunk) => chunk.object === "chat.completion.chunk" && !chunk.usage)).toBe(true);
    expect(raw.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(raw.match(/\[DONE\]/g)).toHaveLength(1);
  });

  it.each([false, true])("joins events and UTF-8 characters split across reads, with CRLF and no final newline (stream=%s)", async (stream) => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(text("olá "))}\r\n${JSON.stringify(text("🌲"))}`);
    wire.chat = () => venice(chunked(...Array.from(bytes, (byte) => Uint8Array.of(byte))));
    const response = (await run({ stream })).response;
    const content = stream
      ? sseData(await response.text()).map((chunk) => chunk.choices[0].delta.content ?? "").join("")
      : (await response.json()).choices[0].message.content;
    expect(content).toBe("olá 🌲");
  });

  const BROKEN = [
    ["an HTML page served as 200", `<!doctype html><html>${LEAK}</html>\n`],
    ["an empty body", ""],
    ["metadata only", ndjson(META)],
    ["a damaged event", `{"kind":"content","content":"${LEAK}\n`],
    ["a cut final event", `{"kind":"content","content":"${LEAK}`],
    ["an error event", ndjson({ kind: "error", message: LEAK })],
    ["an error field", ndjson({ error: LEAK })],
    ["non-text content", ndjson({ kind: "content", content: { secret: LEAK } })],
    ["an oversized event", ndjson(text("x".repeat(1_000_001)))],
  ];

  it.each(BROKEN.flatMap((row) => [false, true].map((stream) => [...row, stream])))("turns %s into a 502 (stream=%s)", async (_name, body, stream) => {
    wire.chat = () => venice(body);
    const result = await run({ stream });
    expect(result.response.status).toBe(502);
    const raw = await result.response.text();
    expect(JSON.parse(raw).error.message).toMatch(/^Venice Web /);
    expect(raw).not.toContain(LEAK);
  });

  it.each(BROKEN.filter(([name]) => !["an HTML page served as 200", "an empty body", "metadata only"].includes(name)))(
    "ends a started stream with an error and no stop on %s",
    async (_name, body) => {
      wire.chat = () => venice(ndjson(text("partial")) + body);
      const raw = await (await run({ stream: true })).response.text();
      const chunks = sseData(raw);
      expect(chunks.at(-1).error.message).toMatch(/^Venice Web /);
      expect(chunks.some((chunk) => chunk.choices?.[0]?.finish_reason)).toBe(false);
      expect(raw).not.toContain(LEAK);
      // The same partial answer is never a successful JSON completion.
      expect((await run()).response.status).toBe(502);
    },
  );

  it("stops buffering a line that never ends", async () => {
    const cancel = vi.fn();
    const block = new TextEncoder().encode("x".repeat(65_536));
    wire.chat = () => venice(new ReadableStream({ pull(controller) { controller.enqueue(block); }, cancel }));
    const result = await run();
    expect(result.response.status).toBe(502);
    expect(cancel).toHaveBeenCalled();
  });

  it.each([false, true])("reports a broken upstream body without its text (stream=%s)", async (stream) => {
    wire.chat = () => {
      let pulls = 0;
      return venice(new ReadableStream({ pull(controller) { if (pulls++) controller.error(new Error(LEAK)); else controller.enqueue(new TextEncoder().encode(ndjson(text("partial")))); } }));
    };
    const result = await run({ stream });
    const raw = await result.response.text();
    expect(result.response.status).toBe(stream ? 200 : 502);
    expect(raw).toContain("Venice Web stream was interrupted");
    expect(raw).not.toContain(LEAK);
    expect(raw).not.toContain('"finish_reason":"stop"');
  });

  it("cancels the upstream body when the client leaves", async () => {
    const cancel = vi.fn();
    wire.chat = () => venice(new ReadableStream({ start(body) { body.enqueue(new TextEncoder().encode(ndjson(text("early")))); }, cancel }));
    const reader = (await run({ stream: true })).response.body.getReader();
    await reader.read();
    await reader.read();
    const blocked = reader.read();
    await reader.cancel("client left");
    await blocked;
    expect(cancel).toHaveBeenCalled();
  });

  it("errors the client stream, without a stop chunk, when the caller aborts mid-answer", async () => {
    const controller = new AbortController();
    // Like fetch, the mocked body fails when the request signal aborts.
    wire.chat = (init) => venice(new ReadableStream({ start(body) { body.enqueue(new TextEncoder().encode(ndjson(text("early")))); init.signal.addEventListener("abort", () => body.error(init.signal.reason)); } }));
    const reader = (await run({ stream: true, signal: controller.signal })).response.body.getReader();
    await reader.read();
    await reader.read();
    const blocked = reader.read();
    controller.abort();
    await expect(blocked).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("Venice Web HTTP errors and redirects", () => {
  const STAGES = { lookup: ["lookup"], mint: ["lookup", "mint"], chat: ["lookup", "mint", "chat"] };

  it.each([
    ["lookup", 401, 401, "session_expired"],
    ["lookup", 403, 401, "session_expired"],
    ["lookup", 429, 429, "rate_limited"],
    ["lookup", 500, 500, "HTTP_500"],
    ["mint", 401, 401, "session_expired"],
    ["mint", 403, 401, "session_expired"],
    ["mint", 404, 404, "HTTP_404"],
    ["mint", 429, 429, "rate_limited"],
    ["chat", 401, 401, "session_expired"],
    ["chat", 402, 402, "HTTP_402"],
    ["chat", 403, 403, "forbidden"],
    ["chat", 404, 404, "HTTP_404"],
    ["chat", 429, 429, "rate_limited"],
    ["chat", 503, 503, "HTTP_503"],
  ])("maps a %s %i to %i %s, stops there and relays no upstream text", async (stage, upstreamStatus, status, code) => {
    wire[stage] = () => new Response(LEAK, { status: upstreamStatus, headers: { "retry-after": "7" } });
    const result = await run();
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get("retry-after")).toBe(upstreamStatus === 429 ? "7" : null);
    const raw = await result.response.text();
    expect(JSON.parse(raw).error.code).toBe(code);
    expect(raw).not.toContain(LEAK);
    expect(kinds()).toEqual(STAGES[stage]);
  });

  it.each(Object.keys(STAGES).flatMap((stage) => [301, 302, 303, 307, 308].map((status) => [stage, status])))(
    "never follows a %s redirect (%i), so no credential is forwarded",
    async (stage, status) => {
      wire[stage] = () => new Response(null, { status, headers: { location: "https://attacker.invalid/steal" } });
      const result = await run();
      expect(result.response.status).toBe(401);
      expect((await errorOf(result)).code).toBe("session_expired");
      expect(wire.followed).toEqual([]);
      expect(kinds()).toEqual(STAGES[stage]);
      expect(wire.calls.every((call) => call.init.redirect === "manual")).toBe(true);
    },
  );

  it.each(Object.keys(STAGES))("treats a transport that refuses a %s redirect as an expired session", async (stage) => {
    wire[stage] = () => { throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") }); };
    const result = await run();
    expect((await errorOf(result)).code).toBe("session_expired");
    expect(kinds()).toEqual(STAGES[stage]);
  });

  it.each(Object.keys(STAGES))("maps a %s network failure to 502 without its text", async (stage) => {
    wire[stage] = () => { throw new TypeError(LEAK); };
    const result = await run();
    expect(result.response.status).toBe(502);
    const raw = await result.response.text();
    expect(JSON.parse(raw).error.code).toBe("network_error");
    expect(raw).not.toContain(LEAK);
  });

  it.each(Object.keys(STAGES))("propagates a caller abort during the %s request", async (stage) => {
    const controller = new AbortController();
    wire[stage] = () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); };
    await expect(run({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(kinds()).toEqual(STAGES[stage]);
  });

  it("sends nothing when already aborted", async () => {
    await expect(run({ signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(wire.calls).toHaveLength(0);
  });

  it.each([
    ["no client", "lookup", () => Response.json({ response: null }), 401, "session_expired"],
    ["no active session", "lookup", () => Response.json({ response: { sessions: [] } }), 401, "session_expired"],
    ["an unreadable lookup", "lookup", () => venice(`<html>${LEAK}</html>`), 502, "invalid_response"],
    ["a lookup of the wrong shape", "lookup", () => Response.json({ sessions: [] }), 502, "invalid_response"],
    ["a path in the session id", "lookup", () => Response.json({ response: { sessions: [{ id: "../../../evil?x=", status: "active" }] } }), 502, "invalid_response"],
    ["an unreadable token reply", "mint", () => venice(LEAK), 502, "invalid_response"],
    ["a missing token", "mint", () => Response.json({}), 502, "invalid_response"],
    ["a token with a header break", "mint", () => Response.json({ jwt: `${sessionToken("u")}\r\nX: 1` }), 502, "invalid_response"],
    ["a token without a subject", "mint", () => Response.json({ jwt: jwt({ exp: nowSeconds() + 60 }) }), 502, "invalid_response"],
    ["an already expired token", "mint", () => Response.json({ jwt: sessionToken("u", -5) }), 502, "invalid_response"],
  ])("stops on %s", async (_name, stage, route, status, code) => {
    wire[stage] = route;
    const result = await run();
    expect(result.response.status).toBe(status);
    const raw = await result.response.text();
    expect(JSON.parse(raw).error.code).toBe(code);
    expect(raw).not.toContain(LEAK);
    expect(kinds()).toEqual(STAGES[stage]);
  });
});

describe("Venice Web session token lifecycle", () => {
  const bearer = (call) => call.init.headers.Authorization.slice("Bearer ".length);

  it("reuses a token until ten seconds before its expiry, then mints a new one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-27T12:00:00Z").getTime();
    vi.setSystemTime(start);
    await run();
    vi.setSystemTime(start + 3_589_000);
    await run();
    expect(callsOf("mint")).toHaveLength(1);
    expect(bearer(callsOf("chat")[1])).toBe(wire.issued[0].token);
    vi.setSystemTime(start + 3_591_000);
    await run();
    expect(callsOf("lookup")).toHaveLength(2);
    expect(callsOf("mint")).toHaveLength(2);
    expect(bearer(callsOf("chat")[2])).toBe(wire.issued[1].token);
  });

  it("assumes 55 seconds for a token without exp, and never caches a nearly expired one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    wire.mint = () => Response.json({ jwt: jwt({ sub: "user_synthetic_a" }) });
    await run();
    vi.setSystemTime(start + 44_000);
    await run();
    expect(callsOf("mint")).toHaveLength(1);
    vi.setSystemTime(start + 46_000);
    await run();
    expect(callsOf("mint")).toHaveLength(2);

    wire.mint = () => Response.json({ jwt: sessionToken("user_synthetic_a", 8) });
    const executor = new VeniceWebExecutor();
    await run({ executor });
    await run({ executor });
    expect(callsOf("mint")).toHaveLength(4);
  });

  it("stops reusing a cached token once the cookie JWT itself expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    const shortCookie = jwt({ id: "client_short", exp: Math.floor(start / 1000) + 30 });
    ACCOUNTS.set(shortCookie, { sessionId: "sess_a", userId: "user_synthetic_a" });
    try {
      expect((await run({ credentials: credential(shortCookie) })).response.status).toBe(200);
      vi.setSystemTime(start + 31_000);
      const sends = wire.calls.length;
      expect((await errorOf(await run({ credentials: credential(shortCookie) }))).code).toBe("session_expired");
      expect(wire.calls).toHaveLength(sends);
    } finally {
      ACCOUNTS.delete(shortCookie);
    }
  });

  it.each([
    [401, 2], [403, 2], [302, 2], [429, 1], [500, 1],
  ])("after a chat %i the token has been minted %i time(s) by the next request", async (status, mints) => {
    wire.chat = () => new Response(null, { status });
    await run();
    wire.chat = null;
    expect((await run()).response.status).toBe(200);
    expect(callsOf("mint")).toHaveLength(mints);
    // A rejected request is never replayed on its own.
    expect(callsOf("chat")).toHaveLength(2);
  });

  it("keeps a newer token when an older request is rejected late", async () => {
    const sessions = createVeniceSessions();
    const send = (url, init) => upstream(url, init);
    const first = await sessions.token({ clientJwt: CLIENT_A, send });
    sessions.forget(first);
    const second = await sessions.token({ clientJwt: CLIENT_A, send });
    sessions.forget(first);
    expect(await sessions.token({ clientJwt: CLIENT_A, send })).toBe(second);
    expect(callsOf("mint")).toHaveLength(2);
  });

  it("does not share a token between connections with different proxy settings", async () => {
    const sessions = createVeniceSessions();
    const send = (url, init) => upstream(url, init);
    await sessions.token({ clientJwt: CLIENT_A, proxyOptions: { connectionProxyUrl: "http://one.invalid" }, send });
    await sessions.token({ clientJwt: CLIENT_A, proxyOptions: { connectionProxyUrl: "http://two.invalid" }, send });
    expect(callsOf("mint")).toHaveLength(2);
  });

  it("keeps every token, user id and eviction with the selected account", async () => {
    const results = await Promise.all([CLIENT_A, CLIENT_B, CLIENT_A, CLIENT_B].map((clientJwt) => run({ credentials: credential(clientJwt), body: { messages: [{ role: "user", content: ACCOUNTS.get(clientJwt).userId }] } })));
    expect(results.map((result) => result.response.status)).toEqual([200, 200, 200, 200]);
    const ownerOf = (token) => wire.issued.find((issued) => issued.token === token)?.userId;
    for (const call of callsOf("chat")) {
      const envelope = JSON.parse(call.init.body);
      expect(ownerOf(bearer(call))).toBe(envelope.prompt[0].content);
      expect(envelope.userId).toBe(envelope.prompt[0].content);
    }
    for (const call of callsOf("mint")) {
      expect(call.url).toBe(veniceWebTokenUrl(ACCOUNTS.get(clientCookieOf(call.init)).sessionId));
    }

    // Rejecting account A leaves account B's cached token alone.
    await run({ credentials: credential(CLIENT_B) });
    const mintsBefore = callsOf("mint").length;
    wire.chat = () => new Response(null, { status: 401 });
    await run({ credentials: credential(CLIENT_A) });
    wire.chat = null;
    await run({ credentials: credential(CLIENT_B) });
    expect(callsOf("mint")).toHaveLength(mintsBefore);
    await run({ credentials: credential(CLIENT_A) });
    expect(callsOf("mint")).toHaveLength(mintsBefore + 1);
    expect(clientCookieOf(callsOf("mint").at(-1).init)).toBe(CLIENT_A);
  });
});

describe("Venice Web through the gateway, with the executor lookup substituted", () => {
  const dispatch = (endpoint, format, stream) => {
    const body = { model: "venice-web/venice-uncensored", messages: [{ role: "user", content: "hi" }], stream, ...(format === FORMATS.CLAUDE ? { max_tokens: 50 } : null) };
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return handleChatCore({ body, modelInfo: { provider: "venice-web", model: "venice-uncensored" }, credentials: { ...credential(), authType: "cookie" }, clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: "synthetic-connection", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
  };

  it.each([["/v1/chat/completions", FORMATS.OPENAI, false], ["/v1/chat/completions", FORMATS.OPENAI, true], ["/v1/messages", FORMATS.CLAUDE, false], ["/v1/messages", FORMATS.CLAUDE, true]])(
    "serves %s (%s, stream=%s) and records estimated usage once for the connection",
    async (endpoint, format, stream) => {
      const result = await dispatch(endpoint, format, stream);
      expect(result.response.status).toBe(200);
      const raw = await result.response.text();
      expect(raw).toContain("Hello ");
      expect(raw).toContain("there");
      expect(callsOf("chat")).toHaveLength(1);
      await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalled());
      expect(saveRequestUsage.mock.calls).toHaveLength(1);
      const saved = saveRequestUsage.mock.calls[0][0];
      expect(saved).toMatchObject({ provider: "venice-web", model: "venice-uncensored", connectionId: "synthetic-connection", tokens: { estimated: true } });
      expect(saved.tokens.prompt_tokens ?? saved.tokens.input_tokens).toBeGreaterThan(0);
      expect(saved.tokens.completion_tokens ?? saved.tokens.output_tokens).toBeGreaterThan(0);
    },
  );

  it("surfaces an expired session to account handling", async () => {
    wire.chat = () => new Response("", { status: 401 });
    const result = await dispatch("/v1/chat/completions", FORMATS.OPENAI, false);
    expect(result).toMatchObject({ success: false, status: 401 });
  });
});
