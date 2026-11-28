import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), handleChat: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({
  logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
  logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
}) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
}));
import Executor, { deepSeekWebProofOfWorkEnabled } from "../../open-sse/executors/deepseek-web.js";
import { solveChallenge, POW_TARGET } from "../../open-sse/executors/deepseek-web/pow.js";
import { deepSeekHashV1, deepSeekHashV1Reference, sha3_256Fips202Reference } from "../../open-sse/executors/deepseek-web/deepseek-pow-hash.js";
import { runWithProviderAttemptContext, settleProviderAttemptDispatch } from "../../open-sse/services/providerAttemptContext.js";
import { processAttemptResult } from "../../src/sse/handlers/chat/singleModel/postProcess.js";
import { proxyAwareFetch, __setOriginalFetchForTesting, __setProxyDispatcherForTesting, __clearProxyDispatchersForTesting } from "../../open-sse/utils/proxyFetch.js";
import { readBounded } from "../../open-sse/executors/deepseek-web/protocol.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { detectFormatByEndpoint } from "../../open-sse/translator/formats.js";
import * as chatRoute from "../../src/app/api/v1/chat/completions/route.js";
import * as messagesRoute from "../../src/app/api/v1/messages/route.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const frames = [
  { v: { response: { thinking_enabled: true, fragments: [{ type: "THINK", content: "consider " }] } } },
  { v: "this" },
  { p: "response/fragments", v: [{ type: "RESPONSE", content: "回答 " }] },
  { p: "response/fragments", v: { type: "ANSWER", content: "answer" } },
  { p: "response/status", v: "FINISHED" },
];
const sse = (values = frames) => values.map(v => `data: ${JSON.stringify(v)}\n\n`).join("");
const challenge = (salt = "synthetic-A", nonce = 3) => ({ algorithm: "DeepSeekHashV1", salt,
  expire_at: 1900000000, difficulty: 8, signature: `signature-${salt}`,
  challenge: deepSeekHashV1(`${salt}_1900000000_${nonce}`), target_path: POW_TARGET });
const input = (extra = {}) => ({ model: "deepseek-chat", stream: false,
  body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: "synthetic-A" }, ...extra });
let completion;
let challengeReply;
let routeResults;
function installFetch() {
  mocks.fetch.mockImplementation(async (url, init) => {
    expect(new URL(url).origin).toBe("https://chat.deepseek.com");
    expect(["manual", "error"]).toContain(init.redirect);
    const auth = init.headers.Authorization;
    if (url.endsWith("/users/current")) return json({ data: { biz_data: { token: `access-${auth.slice(7)}` } } });
    if (url.endsWith("/chat_session/create")) return json({ data: { biz_data: { chat_session: { id: `session-${auth.slice(7)}` } } } });
    if (url.endsWith("/create_pow_challenge")) {
      expect(JSON.parse(init.body)).toEqual({ target_path: POW_TARGET });
      return challengeReply ? challengeReply() : json({ data: { biz_data: { challenge: challenge(auth.slice(7)) } } });
    }
    expect(url).toBe("https://chat.deepseek.com/api/v0/chat/completion");
    const proof = JSON.parse(Buffer.from(init.headers["X-Ds-Pow-Response"], "base64").toString());
    expect(proof).toEqual({ algorithm: "DeepSeekHashV1", salt: auth.slice(7), answer: 3,
      challenge: challenge(auth.slice(7)).challenge, signature: `signature-${auth.slice(7)}`, target_path: POW_TARGET });
    expect(JSON.parse(init.body).chat_session_id).toBe(`session-${auth.slice(7)}`);
    return completion(url, init);
  });
  vi.stubGlobal("fetch", mocks.fetch);
}
beforeEach(() => {
  vi.clearAllMocks(); routeResults = [];
  // Default source proof is exercised without an operator switch.
  vi.stubEnv("DURINDOOR_DEEPSEEK_WEB_POW", undefined);
  completion = () => new Response(sse(), { headers: { "content-type": "text/event-stream" } });
  challengeReply = null;
  installFetch();
  // Keep real public routes, translation, chatCore and executor. Isolate dashboard
  // authentication/account selection at handleChat; no database or real account is used.
  mocks.handleChat.mockImplementation(async request => {
    const body = await request.json();
    const result = await handleChatCore({ body, modelInfo: { provider: "deepseek-web", model: "deepseek-chat" },
      credentials: { apiKey: "synthetic-A" }, sourceFormatOverride: detectFormatByEndpoint(new URL(request.url).pathname, body),
      clientRawRequest: { endpoint: new URL(request.url).pathname, body, headers: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    routeResults.push(result);
    return result.response;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("requires source proof regardless of legacy bypass flags", async () => {
  for (const value of [undefined, "", "false", "off", "source"]) {
    expect(deepSeekWebProofOfWorkEnabled({ DURINDOOR_DEEPSEEK_WEB_POW: value })).toBe(true);
    vi.stubEnv("DURINDOOR_DEEPSEEK_WEB_POW", value);
    mocks.fetch.mockClear();
    const { response } = await new Executor().execute(input());
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].message.content).toBe("回答 answer");
    expect(mocks.fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/v0/users/current", "/api/v0/chat_session/create", "/api/v0/chat/create_pow_challenge", "/api/v0/chat/completion",
    ]);
  }
});

it("checks the pinned permutation against FIPS control and independent reference", () => {
  // Vectors from OmniRoute tests/unit/deepseek-pow-js-only.test.ts at the same pin (MIT).
  for (const [text, expected] of [
    ["1122334455667788_1778891543095_0", "311b26ae1e0fe7375e242958ce46db5552a6c67fea3f96880dcd846c63a74286"],
    ["vector_42_3", "2ffed26ea9e1d6f4bbe49a266d98fe04ad9a5ad4c6d765862de8d18c513c3815"],
  ]) expect(deepSeekHashV1(text)).toBe(expected);
  for (const text of ["", "abc", "x".repeat(140), "回答"] ) {
    expect(sha3_256Fips202Reference(text)).toBe(createHash("sha3-256").update(text).digest("hex"));
    expect(deepSeekHashV1(text)).toBe(deepSeekHashV1Reference(text));
  }
});
it("solves deterministic challenges in the real bounded worker with isolated accounts", async () => {
  const answers = await Promise.all([solveChallenge(challenge("A")), solveChallenge(challenge("B", 5))]);
  expect(answers.map(v => JSON.parse(Buffer.from(v, "base64")).answer)).toEqual([3, 5]);
  await expect(solveChallenge({ ...challenge(), algorithm: "unknown" })).rejects.toThrow();
  await expect(solveChallenge({ ...challenge(), difficulty: 250001 })).rejects.toThrow();
  await expect(solveChallenge({ ...challenge(), challenge: "0".repeat(64), difficulty: 250000 }, { timeoutMs: 1 })).rejects.toThrow(/deadline/);
  const controller = new AbortController();
  const pending = solveChallenge({ ...challenge(), challenge: "0".repeat(64), difficulty: 250000 }, { signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(JSON.parse(Buffer.from(await solveChallenge(challenge()), "base64")).answer).toBe(3);
});
it("packages worker assets offline using the existing CLI copy helper and runs the copied worker", async () => {
  const require = createRequire(import.meta.url);
  const { copyRecursive } = require("../../cli/scripts/build-cli.js");
  const manifest = require("../../scripts/packaging-manifest.json");
  expect(manifest).toContainEqual({ path: "open-sse", directory: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-pack-"));
  const cwd = process.cwd();
  const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
  try {
    copyRecursive(path.resolve(sourceRoot, "open-sse/executors/deepseek-web"), path.join(root, "open-sse/executors/deepseek-web"));
    const typeChecks = manifest.find(entry => entry.path === "src/shared/utils/typeChecks.js");
    expect(typeChecks).toBeTruthy();
    fs.mkdirSync(path.join(root, "src/shared/utils"), { recursive: true });
    fs.copyFileSync(path.resolve(sourceRoot, typeChecks.path), path.join(root, typeChecks.path));
    expect(fs.existsSync(path.join(root, "open-sse/executors/deepseek-web/deepseek-pow-worker.mjs"))).toBe(true);
    process.chdir(root);
    expect(JSON.parse(Buffer.from(await solveChallenge(challenge()), "base64")).answer).toBe(3);
  } finally { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); }
});

for (const stream of [false, true]) {
  describe(`real executor stream=${stream}`, () => {
    it("decodes native fragments and bare deltas; preserves route and two-account proof binding", async () => {
      const executor = new Executor();
      for (const account of ["A", "B"]) {
        const proxyOptions = { strictProxy: true, proxyPoolId: `pool-${account}`, connectionProxyUrl: `http://synthetic-${account}:8080` };
        const start = mocks.fetch.mock.calls.length;
        const result = await executor.execute(input({ stream, credentials: { apiKey: `synthetic-${account}` }, proxyOptions }));
        expect(result.response.status).toBe(200);
        const output = await result.response.text();
        expect(output).toContain("回答 answer"); expect(output).toContain("consider this"); expect(output).not.toContain("FINISHED");
        const calls = mocks.fetch.mock.calls.slice(start);
        expect(calls).toHaveLength(4);
        for (const [, init] of calls) expect(init.proxyOptions).toEqual(proxyOptions);
      }
    });
    for (const [code, status] of [[40003, 401], [40002, 429], [45678, 502]]) {
      it(`safely maps the HTTP200 error envelope ${code}`, async () => {
        completion = () => json({ code, msg: "synthetic-secret-do-not-echo", data: null });
        const result = await new Executor().execute(input({ stream }));
        expect(result.response.status).toBe(status);
        expect(await result.response.text()).not.toMatch(/synthetic-secret|finish_reason|usage/);
        expect(mocks.fetch).toHaveBeenCalledTimes(4);
      });
    }
    for (const [name, make] of [
      ["missing terminal", () => new Response(sse(frames.slice(0, -1)))],
      ["malformed frame", () => new Response(sse() + 'data: {broken}\n\n')],
      ["DONE without FINISHED", () => new Response(sse(frames.slice(0, -1)) + 'data: [DONE]\n\n')],
      ["empty completion", () => new Response('data: {"p":"response/status","v":"FINISHED"}\n\n')],
      ["provider exception", () => { throw new Error("synthetic-secret"); }],
      ["oversized body", () => new Response("x".repeat(4 * 1024 * 1024 + 1))],
      ["broken UTF8", () => new Response(Uint8Array.of(0xe4, 0xb8))],
    ]) {
      it(`refuses ${name} with no success or replay`, async () => {
        completion = make;
        const result = await new Executor().execute(input({ stream }));
        expect(result.response.status).toBe(502);
        expect(result.claudeRequestScoped).toBe(true);
        expect(await result.response.text()).not.toMatch(/finish_reason|usage|synthetic-secret/);
        expect(mocks.fetch).toHaveBeenCalledTimes(4);
      });
    }
    it("handles multibyte characters split between upstream chunks", async () => {
      const bytes = new TextEncoder().encode(sse());
      completion = () => new Response(new ReadableStream({ start(c) {
        for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close();
      } }));
      const result = await new Executor().execute(input({ stream }));
      expect(result.response.status).toBe(200); expect(await result.response.text()).toContain("回答 answer");
    });
    it("retains complete legacy envelopes", async () => {
      completion = () => new Response(sse([{ data: { biz_data: { response: "legacy answer" } } }]) + "data: [DONE]\n\n");
      const result = await new Executor().execute(input({ stream }));
      expect(result.response.status).toBe(200); expect(await result.response.text()).toContain("legacy answer");
    });
  });
}

it("refuses unknown challenges before any completion submission", async () => {
  challengeReply = () => json({ data: { biz_data: { challenge: { ...challenge(), algorithm: "unknown" } } } });
  const result = await new Executor().execute(input());
  expect(result.response.status).toBe(502); expect(mocks.fetch).toHaveBeenCalledTimes(3);
});
it("does not follow challenge redirects or fall back when the strict proxy fails", async () => {
  challengeReply = () => new Response(null, { status: 302, headers: { location: "https://evil.test" } });
  expect((await new Executor().execute(input())).response.status).toBe(502);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  mocks.fetch.mockReset().mockRejectedValue(new Error("proxy synthetic-secret"));
  const result = await new Executor().execute(input({ proxyOptions: { strictProxy: true, proxyPoolId: "A" } }));
  expect(result.response.status).toBe(502); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(await result.response.text()).not.toContain("synthetic-secret");
});
it("bounds a stalled completion body with caller cancellation", async () => {
  const controller = new AbortController();
  completion = () => { queueMicrotask(() => controller.abort()); return new Response(new ReadableStream({ start() {} })); };
  const result = await new Executor().execute(input({ signal: controller.signal }));
  expect(result.response.status).toBe(499); expect(result.claudeRequestScoped).toBe(true);
  expect(await result.response.text()).not.toMatch(/usage|finish_reason/);
});
it("bounds elapsed response reads with a deadline and cancels the reader", async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const pending = readBounded(new Response(new ReadableStream({ cancel })), controller.signal);
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalled();
});

for (const [route, endpoint] of [[chatRoute, "/v1/chat/completions"], [messagesRoute, "/v1/messages"]]) {
  for (const stream of [false, true]) {
    it(`public ${endpoint} stream=${stream} projects native fragments`, async () => {
      const response = await route.POST(new Request(`https://gateway.test${endpoint}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "ds-web/deepseek-chat", stream, max_tokens: 200, messages: [{ role: "user", content: "hi" }] }) }));
      expect(response.status).toBe(200);
      const text = await response.text(); expect(text).toContain("回答 answer");
      expect(text).not.toContain("FINISHED"); expect(mocks.fetch).toHaveBeenCalledTimes(4);
    });
    it(`public ${endpoint} stream=${stream} preserves fixed errors without success`, async () => {
      completion = () => json({ code: 40003, msg: "synthetic-secret" });
      const response = await route.POST(new Request(`https://gateway.test${endpoint}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "ds-web/deepseek-chat", stream, max_tokens: 200, messages: [{ role: "user", content: "hi" }] }) }));
      expect(response.status).toBe(401); expect(await response.text()).not.toMatch(/synthetic-secret|finish_reason|usage/);
      expect(mocks.fetch).toHaveBeenCalledTimes(4);
    });
    it(`public ${endpoint} stream=${stream} marks an accepted broken completion terminal`, async () => {
      completion = () => new Response(sse(frames.slice(0, -1)));
      const response = await route.POST(new Request(`https://gateway.test${endpoint}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "ds-web/deepseek-chat", stream, max_tokens: 200, messages: [{ role: "user", content: "hi" }] }) }));
      expect(response.status).toBe(502); expect(routeResults.at(-1).claudeRequestScoped).toBe(true);
      const state = { excludeConnectionIds: new Set() };
      const decision = await processAttemptResult({ provider: "deepseek-web" }, state,
        { credentials: { connectionId: "synthetic-A" } }, routeResults.at(-1));
      expect(decision.kind).toBe("terminal"); expect(state.excludeConnectionIds.size).toBe(0);
      expect(await response.text()).not.toMatch(/finish_reason|usage/); expect(mocks.fetch).toHaveBeenCalledTimes(4);
    });
  }
}

it("enforces the request deadline after a completion was accepted", async () => {
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => nativeTimeout(ms === 60000 ? 1000 : ms));
  completion = () => new Response(new ReadableStream({ start() {} }));
  const result = await new Executor().execute(input());
  expect(result.response.status).toBe(504); expect(result.claudeRequestScoped).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(4);
});
for (const kind of ["success", "envelope", "truncated"]) {
  it(`retains one completion quota ticket for ${kind}; setup and challenge are unbilled`, async () => {
    if (kind === "envelope") completion = () => json({ code: 40002 });
    if (kind === "truncated") completion = () => new Response(sse(frames.slice(0, -1)));
    const settle = vi.fn(async () => ({ changed: true }));
    const begin = vi.fn(async () => ({ tracked: true, settle, release: vi.fn() }));
    const result = await runWithProviderAttemptContext(() => Date.now(), () => new Executor().execute(input()), { beginQuotaDispatch: begin });
    expect(begin).toHaveBeenCalledTimes(1);
    await settleProviderAttemptDispatch(result.response, { success: kind === "success", reason: kind });
    expect(settle).toHaveBeenCalledWith({ success: kind === "success", reason: kind });
  });
}
it("refuses a pre-aborted caller without dispatch", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await new Executor().execute(input({ signal: controller.signal }));
  expect(result.response.status).toBe(499); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("refuses a challenge body above the setup size bound without a submit", async () => {
  challengeReply = () => new Response("x".repeat(65537));
  const result = await new Executor().execute(input());
  expect(result.response.status).toBe(502); expect(mocks.fetch).toHaveBeenCalledTimes(3);
});
it("marks ambiguous completion HTTP502 terminal without a second attempt", async () => {
  completion = () => json({ msg: "synthetic-secret" }, 502);
  const result = await new Executor().execute(input());
  expect(result.response.status).toBe(502); expect(result.claudeRequestScoped).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(4);
});

it("keeps all four requests on the selected strict proxy through the real proxy router", async () => {
  const restore = __setOriginalFetchForTesting(mocks.fetch);
  const routed = (url, { proxyOptions, ...init }) => proxyAwareFetch(url, init, proxyOptions);
  Object.defineProperty(routed, Symbol.for("durindoor.proxyFetch.patched"), { value: true });
  vi.stubGlobal("fetch", routed);
  try {
    for (const account of ["A", "B"]) {
      const proxy = `http://synthetic-${account.toLowerCase()}.test:8080`;
      const dispatcher = Object.freeze({ route: account });
      __setProxyDispatcherForTesting(proxy, dispatcher);
      const start = mocks.fetch.mock.calls.length;
      const result = await new Executor().execute(input({ credentials: { apiKey: `synthetic-${account}` },
        proxyOptions: { strictProxy: true, connectionProxyEnabled: true, connectionProxyUrl: proxy, disableEnvProxy: true } }));
      expect(result.response.status).toBe(200);
      const calls = mocks.fetch.mock.calls.slice(start); expect(calls).toHaveLength(4);
      for (const [, init] of calls) { expect(init.dispatcher).toBe(dispatcher); expect(init).not.toHaveProperty("proxyOptions"); }
    }
    mocks.fetch.mockClear();
    completion = () => { throw new Error("synthetic uncertain submit"); };
    const uncertain = await new Executor().execute(input({ proxyOptions: { strictProxy: false, connectionProxyEnabled: true,
      connectionProxyUrl: "http://synthetic-a.test:8080", disableEnvProxy: true } }));
    expect(uncertain.response.status).toBe(502); expect(uncertain.claudeRequestScoped).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(4); // No proxy-to-direct replay of the accepted/uncertain submit.
    mocks.fetch.mockReset().mockRejectedValue(new Error("synthetic proxy failure"));
    const failed = await new Executor().execute(input({ proxyOptions: { strictProxy: true, connectionProxyEnabled: true,
      connectionProxyUrl: "http://synthetic-a.test:8080", disableEnvProxy: true } }));
    expect(failed.response.status).toBe(502); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  } finally { restore(); __clearProxyDispatchersForTesting(); }
});

it("refuses a third solver while two bounded workers are occupied and recovers slots", async () => {
  const impossible = { ...challenge(), challenge: "0".repeat(64), difficulty: 250000 };
  const first = solveChallenge(impossible, { timeoutMs: 100 });
  const second = solveChallenge(impossible, { timeoutMs: 100 });
  const settled = Promise.allSettled([first, second]);
  await expect(solveChallenge(challenge())).rejects.toThrow(/capacity/);
  expect((await settled).every(result => result.status === "rejected")).toBe(true);
  expect(JSON.parse(Buffer.from(await solveChallenge(challenge()), "base64")).answer).toBe(3);
});
it("retains legacy OpenAI SSE bodies but refuses malformed, empty or mixed-truncated ones", async () => {
  const deltas = [{ choices: [{ delta: { content: "legacy answer" }, finish_reason: null }] }];
  completion = () => new Response(sse([...deltas, { choices: [{ delta: {}, finish_reason: "stop" }] }]));
  expect((await new Executor().execute(input())).response.status).toBe(200);
  // Keep the original lone delta as a negative regression: EOF is not a terminal.
  completion = () => new Response(sse(deltas));
  const legacy = (await new Executor().execute(input())).response;
  expect(legacy.status).toBe(502);
  expect(await legacy.text()).not.toMatch(/legacy answer|finish_reason|usage/);
  for (const body of [sse(deltas) + "data: {\"choices\":[{\"delta\"\n\n", sse([{ choices: [{ delta: {} }] }]),
    sse([...deltas, { p: "response/fragments", v: [{ type: "RESPONSE", content: "native" }] }])]) {
    completion = () => new Response(body);
    const refused = (await new Executor().execute(input())).response;
    expect(refused.status).toBe(502);
    expect(await refused.text()).not.toMatch(/legacy answer|finish_reason|usage/);
  }
});

it("resolves the source worker when the caller is outside the runtime root", async () => {
  const cwd = process.cwd();
  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), "ds-caller-"));
  try {
    process.chdir(unrelated);
    expect(JSON.parse(Buffer.from(await solveChallenge(challenge()), "base64")).answer).toBe(3);
  } finally { process.chdir(cwd); fs.rmSync(unrelated, { recursive: true, force: true }); }
});

for (const stream of [false, true]) {
  for (const [name, values, trailer = ""] of [
    ["original biz_data EOF", [{ data: { biz_data: { response: "ok" } } }]],
    ["original batch-a delta EOF", [{ choices: [{ delta: { content: "pong from deepseek web" } }] }]],
    ["unknown finish", [{ choices: [{ delta: { content: "answer" }, finish_reason: "invalid" }] }]],
    ["malformed delta", [{ choices: [{ delta: { content: {} }, finish_reason: "stop" }] }]],
    ["mixed complete dialects", [...frames, { choices: [{ delta: { content: "legacy" }, finish_reason: "stop" }] }]],
    ["unknown trailing object", [...frames, {}]],
    ["error after terminal", [...frames, { error: { message: "synthetic-secret" } }]],
    ["error path", [...frames.slice(0, -1), { p: "response/error", v: "synthetic-secret" }, frames.at(-1)]],
    ["unterminated terminal record", frames.slice(0, -1), 'data: {"p":"response/status","v":"FINISHED"}'],
    ["truncated after terminal", frames, 'data: {"broken"'],
  ]) {
    it(`refuses ${name} stream=${stream} without publishing success`, async () => {
      completion = () => new Response(sse(values) + trailer);
      const result = await new Executor().execute(input({ stream }));
      expect(result.response.status).toBe(502);
      expect(result.claudeRequestScoped).toBe(true);
      expect(await result.response.text()).not.toMatch(/finish_reason|usage|synthetic-secret/);
      expect(mocks.fetch).toHaveBeenCalledTimes(4);
    });
  }
  it(`accepts legacy DONE and source comments/search metadata stream=${stream}`, async () => {
    for (const text of [sse([{ choices: [{ delta: { content: "answer" } }] }]) + "data: [DONE]\n\n",
      ": keepalive\n\n" + sse([...frames, { p: "response/search_status", v: "FINISHED" }])]) {
      mocks.fetch.mockClear(); completion = () => new Response(text);
      expect((await new Executor().execute(input({ stream }))).response.status).toBe(200);
      expect(mocks.fetch).toHaveBeenCalledTimes(4);
    }
  });
}
