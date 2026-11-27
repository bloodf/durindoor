// Inner.ai Web, registered. Closed mocks only: every send is answered below, an
// unknown URL fails the test, and every token and email is synthetic. Passing
// here says nothing about the live service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const staged = vi.hoisted(() => ({ executor: null }));

// The executor map registers this provider (asserted below); the gateway tests swap in a fresh
// instance per test so the per-account discovery and session caches never cross tests.
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getExecutor: (id) => (id === "inner-ai-web" ? staged.executor : actual.getExecutor(id)) };
});
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), finishPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));

import provider, { INNER_AI_WEB_CHAT_URL, INNER_AI_WEB_MODELS_URL, INNER_AI_WEB_PROFILE_URL, innerAiWebCookieProfile } from "../../open-sse/providers/registry/inner-ai-web.js";
import { InnerAiWebExecutor, discoverInnerAiWebModels, validateInnerAiWebSession } from "../../open-sse/executors/inner-ai-web.js";
import { readInnerAiWebCredential } from "../../open-sse/executors/inner-ai-web/credential.js";
import { findInnerAiWebModel } from "../../open-sse/executors/inner-ai-web/discovery.js";
import { cookieImportConfig, isApprovedCookieName, cookieDomainAllowed, resolveCookieImportContract } from "../../src/shared/utils/cookieImportContract.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { REGISTERED_EXECUTOR_IDS, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { saveRequestUsage } from "@/lib/usageDb.js";

const jwt = (claims) => ["synthetic-header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "synthetic-signature"].join(".");
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const TOKEN_A = jwt({ device_id: "device-a", plan: "free", exp: FUTURE });
const TOKEN_B = jwt({ deviceId: "device-b", plan: "pro", exp: FUTURE });
const EMAIL_A = "account-a@example.com";
const EMAIL_B = "account-b@example.com";

const text = (item) => ({ type: "text", item });
const END = { type: "end_stream", item: "end" };
const frames = (...events) => events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
const sse = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/event-stream" } });

const catalog = () => [
  { id: "uuid-4o", llm_model: "gpt-4o", name: "GPT-4o", ai_model_categories: [{ unique_identifier: "text" }] },
  { id: "uuid-mini", llm_model: "gpt-4.1-mini" },
  { id: "uuid-claude", llm_model: "anthropic/claude-opus-4-5-20260101" },
  { id: "uuid-pro", llm_model: "pro-model", pro_only: true },
  { id: "uuid-ultra", llm_model: "ultra-model", ultra_only: true },
  { id: "uuid-off", llm_model: "disabled-model", enable: false },
  { id: "uuid-noapi", llm_model: "ui-model", unavailable_api: true },
  { id: "uuid-picture", llm_model: "painter", ai_model_categories: [{ name: "Image" }] },
  { id: "uuid-voice", llm_model: "whisper-1" },
  { llm_model: "no-uuid" },
  null,
];

const wire = { calls: [], profile: null, models: null, chat: null };
const accounts = new Map([[TOKEN_A, EMAIL_A], [TOKEN_B, EMAIL_B]]);
const defaults = {
  profile: (init) => Response.json({ data: { email: accounts.get(init.headers["USER-TOKEN"]) } }),
  models: () => Response.json({ ai_models: catalog() }),
  chat: () => sse(frames({ type: "status", code: "provider_timeout_retry" }, text("Hello "), text("there"), END)),
};

const upstream = vi.fn(async (url, init = {}) => {
  const target = String(url);
  wire.calls.push({ url: target, init });
  const route = { [INNER_AI_WEB_PROFILE_URL]: "profile", [INNER_AI_WEB_MODELS_URL]: "models", [INNER_AI_WEB_CHAT_URL]: "chat" }[target];
  if (!route) throw new Error(`unexpected mocked URL ${target}`);
  return (wire[route] ?? defaults[route])(init);
});

let restoreOriginalFetch;
beforeEach(async () => {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
  restoreOriginalFetch = __setOriginalFetchForTesting(upstream);
  vi.stubGlobal("fetch", upstream);
  Object.assign(wire, { calls: [], profile: null, models: null, chat: null });
  staged.executor = new InnerAiWebExecutor();
  vi.mocked(saveRequestUsage).mockClear();
});
afterEach(() => {
  restoreOriginalFetch();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const credential = (token = TOKEN_A, email = EMAIL_A) => ({ apiKey: `${token} ${email}` });
const run = ({ model = "gpt-4o", stream = false, credentials = credential(), body = {}, executor = staged.executor, signal } = {}) =>
  executor.execute({ model, stream, credentials, signal, body: { model, messages: [{ role: "user", content: "ping" }], ...body } });
const urls = () => wire.calls.map((call) => call.url);
const chatCalls = () => wire.calls.filter((call) => call.url === INNER_AI_WEB_CHAT_URL);
const sseData = (raw) => raw.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)));

describe("registered Inner.ai Web provider module", () => {
  it("is a registry entry with its own executor and is no longer staged", () => {
    expect(REGISTRY).toContain(provider);
    expect(REGISTERED_EXECUTOR_IDS).toEqual(expect.arrayContaining(["inner-ai-web", "inaw"]));
    expect(hasSpecializedExecutor("inner-ai-web")).toBe(true);
    expect(STAGED_PROVIDERS["inner-ai-web"]).toBeUndefined();
  });

  it("is a cookie identity separate from the API-key inner-ai entry", () => {
    expect(provider).toMatchObject({ id: "inner-ai-web", category: "webCookie", authType: "cookie", transport: { baseUrl: INNER_AI_WEB_CHAT_URL, executor: "inner-ai-web", authType: "cookie" } });
    expect(REGISTRY.find((entry) => entry.id === "inner-ai")).toMatchObject({ category: "apikey" });
    // Holds before and after registration: no other entry may claim these names.
    const taken = REGISTRY.filter((entry) => entry.id !== provider.id).flatMap((entry) => [entry.id, entry.alias, entry.uiAlias, ...(entry.aliases ?? [])]);
    expect(taken).not.toContain(provider.id);
    expect(taken).not.toContain(provider.alias);
    expect(provider.models.map((model) => model.id)).toHaveLength(19);
  });

  it("imports and captures only the token cookie from app.innerai.com, with an optional paired email and no web login", () => {
    const contract = resolveCookieImportContract(cookieImportConfig(provider));
    expect(contract).toMatchObject({ origin: "https://app.innerai.com", cookieNames: ["token"], cookiePrefixes: [], extensionCapture: true, accountEmail: "optional" });
    expect(isApprovedCookieName(contract, "token")).toBe(true);
    expect(isApprovedCookieName(contract, "refresh_token")).toBe(false);
    expect(cookieDomainAllowed(contract.host, ".innerai.com")).toBe(true);
    expect(cookieDomainAllowed(contract.host, "example.com")).toBe(false);
    expect(innerAiWebCookieProfile.extensionCapture).toBeUndefined();
    expect(innerAiWebCookieProfile.accountEmail).toBe("optional");
    expect(provider.webLogin).toBeUndefined();
  });
});

describe("Inner.ai Web credential", () => {
  it.each([
    [TOKEN_A, ""],
    [`token=${TOKEN_A}`, ""],
    [`token=${TOKEN_A};`, ""],
    [`  ${TOKEN_A} ${EMAIL_A}  `, EMAIL_A],
    [`token=${TOKEN_A} ${EMAIL_A}`, EMAIL_A],
  ])("accepts form %#", (apiKey, email) => {
    expect(readInnerAiWebCredential({ apiKey })).toMatchObject({ token: TOKEN_A, credentialEmail: email, deviceId: "device-a" });
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["an API key", "sk-synthetic-api-key"],
    ["another cookie name", `session=${TOKEN_A}`],
    ["a full cookie header", `theme=dark; token=${TOKEN_A}`],
    ["an undecodable payload", "aaa.bbb.ccc"],
    ["a non-object payload", jwt("text")],
    ["header injection", `${TOKEN_A}\r\nx-extra: 1`],
    ["a bad email", `${TOKEN_A} not-an-email`],
    ["an oversized value", `${TOKEN_A}${"a".repeat(9000)}`],
  ])("rejects %s without any request", async (_name, apiKey) => {
    const result = await run({ credentials: { apiKey } });
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).error.code).toBe("invalid_credential");
    expect(wire.calls).toHaveLength(0);
  });

  it("never borrows an access token or cookie field", async () => {
    const result = await run({ credentials: { accessToken: TOKEN_A, providerSpecificData: { cookie: `token=${TOKEN_A}` } } });
    expect(result.response.status).toBe(401);
    expect(wire.calls).toHaveLength(0);
  });

  it("reports an expired token locally", async () => {
    const result = await run({ credentials: { apiKey: jwt({ exp: Math.floor(Date.now() / 1000) - 1 }) } });
    expect(result.response.status).toBe(401);
    expect((await result.response.json()).error.code).toBe("session_expired");
    expect(wire.calls).toHaveLength(0);
  });
});

describe("Inner.ai Web wire contract", () => {
  it("sends the pinned auth and envelope to the three fixed URLs only", async () => {
    const result = await run({
      credentials: { ...credential(TOKEN_A, "pasted@example.com"), providerSpecificData: { baseUrl: "https://evil.invalid" }, baseUrl: "https://evil.invalid" },
      body: { messages: [{ role: "system", content: "Be brief" }, { role: "assistant", content: "Earlier" }, { role: "user", content: [{ type: "text", text: "ping" }, { type: "image_url", image_url: { url: "data:x" } }] }] },
    });
    expect(result.response.status).toBe(200);
    expect(urls()).toEqual([INNER_AI_WEB_PROFILE_URL, INNER_AI_WEB_MODELS_URL, INNER_AI_WEB_CHAT_URL]);
    const [profile, models, chat] = wire.calls;
    const identity = { Cookie: `token=${TOKEN_A}`, "USER-TOKEN": TOKEN_A, "DEVICE-ID": "device-a", Origin: "https://app.innerai.com", Referer: "https://app.innerai.com/", "User-Agent": expect.stringContaining("Chrome/149") };
    expect(profile.init.headers).toEqual(identity);
    expect(models.init.headers).toEqual({ ...identity, "Content-Type": "application/json", "USER-EMAIL": EMAIL_A });
    expect(chat.init.headers).toEqual(models.init.headers);
    expect(chat.init.method).toBe("POST");
    expect(JSON.parse(chat.init.body)).toEqual({
      message: "[Instructions]\nBe brief\n\n[Assistant]\nEarlier\n\nping",
      session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      context_type: "no_context",
      ai_model: { id: "uuid-4o", llm_model: "gpt-4o" },
      is_extension: false,
      env: "production",
      temporary: true,
      use_web_search: false,
      knowledge_list: [],
    });
    for (const call of wire.calls) expect(["manual", "error"]).toContain(call.init.redirect);
    expect(JSON.stringify(result.headers)).not.toContain(TOKEN_A);
    expect(JSON.stringify(result.headers)).not.toContain(EMAIL_A);
  });

  it.each([
    ["the pasted email", () => new Response("", { status: 500 }), "pasted@example.com", { exp: FUTURE }, "pasted@example.com"],
    ["an email-shaped subject", () => Response.json({}), "", { sub: "subject@example.com", exp: FUTURE }, "subject@example.com"],
    ["no email at all", () => new Response("<html>", { status: 200 }), "", { sub: "user-1", exp: FUTURE }, undefined],
  ])("falls back to %s when the profile has none", async (_name, profile, pasted, claims, expected) => {
    wire.profile = profile;
    const result = await run({ credentials: { apiKey: `${jwt(claims)} ${pasted}`.trim() } });
    expect(result.response.status).toBe(200);
    expect(chatCalls()[0].init.headers["USER-EMAIL"]).toBe(expected);
  });
});

describe("Inner.ai Web discovery", () => {
  it("lists only enabled text models of the account's plan", async () => {
    const free = await discoverInnerAiWebModels({ credentials: credential() });
    expect(free.map((model) => model.id)).toEqual(["gpt-4o", "gpt-4.1-mini", "anthropic/claude-opus-4-5-20260101"]);
    expect(free[0]).toEqual({ id: "gpt-4o", name: "GPT-4o" });
    const pro = await discoverInnerAiWebModels({ credentials: credential(TOKEN_B, EMAIL_B) });
    expect(pro.map((model) => model.id)).toContain("pro-model");
    expect(pro.map((model) => model.id)).not.toContain("ultra-model");
    expect(chatCalls()).toHaveLength(0);
  });

  it.each([["a bare array", (rows) => rows], ["a data array", (rows) => ({ data: rows })]])("accepts %s", async (_name, shape) => {
    wire.models = () => Response.json(shape(catalog()));
    expect(await discoverInnerAiWebModels({ credentials: credential() })).toHaveLength(3);
  });

  it("passes the connection proxy to an injected fetcher and sends nothing for a bad credential", async () => {
    const fetcher = vi.fn(async (url) => (url === INNER_AI_WEB_PROFILE_URL ? Response.json({}) : Response.json(catalog())));
    await discoverInnerAiWebModels({ credentials: credential(), fetcher, proxyOptions: { marker: "proxy-a" } });
    expect(fetcher.mock.calls.map((call) => call[2])).toEqual([{ marker: "proxy-a" }, { marker: "proxy-a" }]);
    fetcher.mockClear();
    await expect(discoverInnerAiWebModels({ credentials: { apiKey: "sk-nope" }, fetcher })).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never substitutes a different model", () => {
    const rows = catalog().slice(0, 3);
    expect(findInnerAiWebModel(rows, "GPT-4O").id).toBe("uuid-4o");
    expect(findInnerAiWebModel(rows, "claude-opus-4-5").id).toBe("uuid-claude");
    expect(findInnerAiWebModel(rows, "gpt-4.1")).toBeNull();
    expect(findInnerAiWebModel(rows, "gpt-4")).toBeNull();
  });

  it("sends no chat for a model the account does not list, then discovers again", async () => {
    const result = await run({ model: "gpt-4.1" });
    expect(result.response.status).toBe(404);
    expect((await result.response.json()).error.code).toBe("model_not_found");
    expect(chatCalls()).toHaveLength(0);
    await run();
    expect(urls().filter((url) => url === INNER_AI_WEB_MODELS_URL)).toHaveLength(2);
  });

  it.each([
    ["a server error", () => new Response("secret upstream detail", { status: 503 }), 503],
    ["a network error", () => { throw new TypeError("socket secret upstream detail"); }, 502],
    ["an HTML page", () => new Response("<html>secret upstream detail</html>"), 502],
    ["an unknown shape", () => Response.json({ items: [] }), 502],
    ["a rate limit", () => new Response("", { status: 429, headers: { "retry-after": "30" } }), 429],
  ])("stops before chat on %s from the catalog", async (_name, models, status) => {
    wire.models = models;
    const result = await run();
    expect(result.response.status).toBe(status);
    expect(await result.response.text()).not.toContain("secret upstream detail");
    expect(chatCalls()).toHaveLength(0);
    if (status === 429) expect(result.response.headers.get("retry-after")).toBe("30");
  });

  it("validates a session with reads only", async () => {
    expect(await validateInnerAiWebSession({ apiKey: credential().apiKey })).toEqual({ valid: true, status: 200 });
    wire.models = () => new Response("", { status: 401 });
    expect(await validateInnerAiWebSession({ apiKey: credential().apiKey })).toMatchObject({ valid: false, status: 401, expired: true });
    wire.models = () => new Response("", { status: 500 });
    expect(await validateInnerAiWebSession({ apiKey: credential().apiKey })).toMatchObject({ valid: false, status: 500, unavailable: true });
    expect(chatCalls()).toHaveLength(0);
  });
});

describe("Inner.ai Web account isolation", () => {
  it("keeps each selected account's token, email, device and plan apart, including cached discovery", async () => {
    for (const [token, email] of [[TOKEN_A, EMAIL_A], [TOKEN_B, EMAIL_B], [TOKEN_A, EMAIL_A], [TOKEN_B, EMAIL_B]]) {
      expect((await run({ credentials: credential(token, email) })).response.status).toBe(200);
    }
    expect(urls().filter((url) => url === INNER_AI_WEB_MODELS_URL)).toHaveLength(2);
    expect(chatCalls().map(({ init }) => [init.headers["USER-TOKEN"], init.headers["USER-EMAIL"], init.headers["DEVICE-ID"], init.headers.Cookie])).toEqual(
      [[TOKEN_A, EMAIL_A, "device-a"], [TOKEN_B, EMAIL_B, "device-b"], [TOKEN_A, EMAIL_A, "device-a"], [TOKEN_B, EMAIL_B, "device-b"]]
        .map(([token, email, device]) => [token, email, device, `token=${token}`]),
    );
    // B's plan unlocks the pro model; A must not reach it through B's cached catalog.
    expect((await run({ model: "pro-model", credentials: credential(TOKEN_B, EMAIL_B) })).response.status).toBe(200);
    expect((await run({ model: "pro-model" })).response.status).toBe(404);
  });

  it("does not cache a catalog resolved without a working profile", async () => {
    wire.profile = () => new Response("", { status: 502 });
    await run();
    await run();
    expect(urls().filter((url) => url === INNER_AI_WEB_PROFILE_URL)).toHaveLength(2);
  });
});

describe("Inner.ai Web expiry, errors and redirects", () => {
  const order = { profile: [INNER_AI_WEB_PROFILE_URL], models: [INNER_AI_WEB_PROFILE_URL, INNER_AI_WEB_MODELS_URL], chat: [INNER_AI_WEB_PROFILE_URL, INNER_AI_WEB_MODELS_URL, INNER_AI_WEB_CHAT_URL] };

  it.each(["profile", "models", "chat"].flatMap((route) => [301, 302, 303, 307, 308, 401, 403].map((status) => [route, status])))(
    "treats %s HTTP %i as an expired session and forwards the credential nowhere",
    async (route, status) => {
      wire[route] = () => new Response("", { status, headers: status < 400 ? { location: "https://evil.invalid/steal" } : {} });
      const result = await run();
      expect(result.response.status).toBe(401);
      expect((await result.response.json()).error).toMatchObject({ code: "session_expired", type: "authentication_error" });
      expect(urls()).toEqual(order[route]);
      for (const call of wire.calls) expect(["manual", "error"]).toContain(call.init.redirect);
    },
  );

  it.each(["profile", "models", "chat"])("maps a refused redirect on %s to an expired session", async (route) => {
    wire[route] = () => { throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") }); };
    const result = await run();
    expect(result.response.status).toBe(401);
    expect(urls()).toEqual(order[route]);
  });

  it("drops cached discovery after chat rejects the session", async () => {
    await run();
    wire.chat = () => new Response("", { status: 401 });
    expect((await run()).response.status).toBe(401);
    wire.chat = null;
    await run();
    expect(urls().filter((url) => url === INNER_AI_WEB_PROFILE_URL)).toHaveLength(2);
  });

  it.each([[400, 400], [429, 429], [500, 500]])("maps chat HTTP %i without relaying upstream text", async (status, expected) => {
    wire.chat = () => new Response(`secret ${TOKEN_A}`, { status });
    const result = await run();
    expect(result.response.status).toBe(expected);
    const raw = await result.response.text();
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain(TOKEN_A);
  });

  it("maps a chat network failure to 502", async () => {
    wire.chat = () => { throw new TypeError(`connect failed ${TOKEN_A}`); };
    const result = await run();
    expect(result.response.status).toBe(502);
    expect(await result.response.text()).not.toContain(TOKEN_A);
  });

  it("rejects a request with no text before any request", async () => {
    const result = await run({ body: { messages: [], tools: [{ type: "function", function: { name: "lookup" } }] } });
    expect(result.response.status).toBe(400);
    expect(wire.calls).toHaveLength(0);
  });

  it("propagates a caller abort", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(wire.calls).toHaveLength(0);
  });
});

describe("Inner.ai Web JSON and SSE", () => {
  it("folds events into one completion and reports no invented usage", async () => {
    const json = await (await run()).response.json();
    expect(json).toMatchObject({ object: "chat.completion", model: "gpt-4o", choices: [{ message: { role: "assistant", content: "Hello there" }, finish_reason: "stop" }] });
    expect(json.usage).toBeUndefined();
  });

  it("reassembles events split across chunks, with CRLF and an unterminated last line", async () => {
    const raw = new TextEncoder().encode(`data: ${JSON.stringify(text("héllo"))}\r\n\r\ndata: ${JSON.stringify(END)}`);
    wire.chat = () => sse(new ReadableStream({ start(controller) { for (const byte of raw) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    expect((await (await run()).response.json()).choices[0].message.content).toBe("héllo");
  });

  it("streams OpenAI chunks with one terminal and ignores events after it", async () => {
    wire.chat = () => sse(frames(text("a"), text("b"), END, text("late")));
    const raw = await (await run({ stream: true })).response.text();
    const chunks = sseData(raw);
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(chunks.map((chunk) => chunk.choices[0].delta.content ?? "").join("")).toBe("ab");
    expect(chunks.filter((chunk) => chunk.choices[0].finish_reason === "stop")).toHaveLength(1);
    expect(raw.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(raw).not.toContain("late");
  });

  it("delivers a delta before the upstream finishes and cancels the upstream with the client", async () => {
    const cancel = vi.fn();
    wire.chat = () => sse(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frames(text("early")))); }, cancel }));
    const reader = (await run({ stream: true })).response.body.getReader();
    await reader.read();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("early");
    const blocked = reader.read();
    await reader.cancel("client left");
    await blocked;
    expect(cancel).toHaveBeenCalled();
  });

  it("errors the client stream, without a stop chunk, when the caller aborts mid-answer", async () => {
    const controller = new AbortController();
    // Like fetch, the mocked body fails when the request signal aborts.
    wire.chat = (init) => sse(new ReadableStream({ start(body) { body.enqueue(new TextEncoder().encode(frames(text("early")))); init.signal.addEventListener("abort", () => body.error(init.signal.reason)); } }));
    const reader = (await run({ stream: true, signal: controller.signal })).response.body.getReader();
    await reader.read();
    await reader.read();
    const blocked = reader.read();
    controller.abort();
    await expect(blocked).rejects.toMatchObject({ name: "AbortError" });
  });

  const FAILURES = [
    ["missing_credits", [{ type: "missing_credits" }], 429, "missing_credits"],
    ["reached_limit", [{ type: "reached_limit" }], 429, "reached_limit"],
    ["rate_limit_reached", [{ type: "rate_limit_reached" }], 429, "rate_limit_reached"],
    ["rate_limit_longer_reached", [{ type: "rate_limit_longer_reached" }], 429, "rate_limit_longer_reached"],
    ["bad JSON", ["{not json"], 502, "invalid_response"],
    ["a non-object event", ["[1]"], 502, "invalid_response"],
    ["a non-string text", [{ type: "text", item: { secret: true } }], 502, "invalid_response"],
    ["no terminal", [], 502, "invalid_response"],
    ["only [DONE]", ["[DONE]"], 502, "invalid_response"],
  ];

  it.each(FAILURES.flatMap((row) => [false, true].map((stream) => [...row, stream])))(
    "turns an immediate %s into an HTTP error",
    async (_name, events, status, code, stream) => {
      wire.chat = () => sse(frames(...events));
      const result = await run({ stream });
      expect(result.response.status).toBe(status);
      expect((await result.response.json()).error.code).toBe(code);
    },
  );

  it.each(FAILURES)("ends a started stream with an error, never a stop, on %s", async (_name, events, status, code) => {
    wire.chat = () => sse(frames(text("partial"), ...events));
    const chunks = sseData(await (await run({ stream: true })).response.text());
    expect(chunks.at(-1).error.code).toBe(code);
    expect(chunks.some((chunk) => chunk.choices?.[0]?.finish_reason)).toBe(false);
    // The same partial answer is never returned as a successful JSON completion.
    expect((await run()).response.status).toBe(status);
  });

  it("reports a broken upstream body without its text", async () => {
    let pulls = 0;
    wire.chat = () => sse(new ReadableStream({ pull(controller) { if (pulls++) controller.error(new Error("secret socket detail")); else controller.enqueue(new TextEncoder().encode(frames(text("partial")))); } }));
    const raw = await (await run({ stream: true })).response.text();
    expect(raw).toContain("Inner.ai Web stream was interrupted");
    expect(raw).not.toContain("secret socket detail");
  });

  it.each([false, true])("emulates tool calls (stream=%s)", async (stream) => {
    wire.chat = () => sse(frames(text('<tool>{"name":"lookup",'), text('"arguments":{"q":"x"}}</tool>'), END));
    const response = (await run({ stream, body: { tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }] } })).response;
    expect(JSON.parse(chatCalls()[0].init.body).message).toContain("Available tools:");
    const call = { id: "inner_0", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } };
    if (!stream) {
      expect((await response.json()).choices[0]).toMatchObject({ message: { content: null, tool_calls: [call] }, finish_reason: "tool_calls" });
      return;
    }
    const chunks = sseData(await response.text());
    expect(chunks[0].choices[0].delta.tool_calls).toEqual([{ index: 0, ...call }]);
    expect(chunks[1].choices[0].finish_reason).toBe("tool_calls");
  });
});

describe("Inner.ai Web through the gateway, with the executor lookup substituted", () => {
  const dispatch = (endpoint, format, stream) => {
    const body = { model: "inner-ai-web/gpt-4o", messages: [{ role: "user", content: "hi" }], stream, ...(format === FORMATS.CLAUDE ? { max_tokens: 50 } : null) };
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return handleChatCore({ body, modelInfo: { provider: "inner-ai-web", model: "gpt-4o" }, credentials: { ...credential(), authType: "cookie" }, clientRawRequest: { endpoint, body, headers: {} }, sourceFormatOverride: format, connectionId: "synthetic-connection", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
  };

  it.each([["/v1/chat/completions", FORMATS.OPENAI, false], ["/v1/chat/completions", FORMATS.OPENAI, true], ["/v1/messages", FORMATS.CLAUDE, false], ["/v1/messages", FORMATS.CLAUDE, true]])(
    "serves %s (%s, stream=%s) and records estimated usage for the connection",
    async (endpoint, format, stream) => {
      const result = await dispatch(endpoint, format, stream);
      expect(result.response.status).toBe(200);
      const raw = await result.response.text();
      expect(raw).toContain("Hello ");
      expect(raw).toContain("there");
      expect(chatCalls()).toHaveLength(1);
      await vi.waitFor(() => expect(saveRequestUsage).toHaveBeenCalled());
      expect(saveRequestUsage.mock.calls).toHaveLength(1);
      const saved = saveRequestUsage.mock.calls[0][0];
      expect(saved).toMatchObject({ provider: "inner-ai-web", model: "gpt-4o", connectionId: "synthetic-connection", tokens: { estimated: true } });
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
