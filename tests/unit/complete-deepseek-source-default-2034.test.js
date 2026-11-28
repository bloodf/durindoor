import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Executor from "../../open-sse/executors/deepseek-web.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), handleChat: vi.fn(), log: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({
  logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
  logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
}) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
}));
import { solveChallenge, POW_TARGET } from "../../open-sse/executors/deepseek-web/pow.js";
import { deepSeekHashV1 } from "../../open-sse/executors/deepseek-web/deepseek-pow-hash.js";
import { processAttemptResult } from "../../src/sse/handlers/chat/singleModel/postProcess.js";
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
let completion;
let challengeReply;
let routeResults;
let executorResults;
let account;
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
  vi.clearAllMocks(); routeResults = []; executorResults = []; account = "A";
  // Default source proof is exercised without an operator switch.
  vi.stubEnv("DURINDOOR_DEEPSEEK_WEB_POW", undefined);
  completion = () => new Response(sse(), { headers: { "content-type": "text/event-stream" } });
  challengeReply = null;
  installFetch();
  // Keep real public routes, translation, chatCore and executor. Isolate dashboard
  // authentication/account selection at handleChat; no database or real account is used.
  mocks.handleChat.mockImplementation(async request => {
    const body = await request.json();
    const executor = new Executor();
    const execute = executor.execute.bind(executor);
    executor.execute = async input => {
      const result = await execute(input);
      executorResults.push(result);
      return result;
    };
    const result = await handleChatCore({ body, executorOverride: executor, modelInfo: { provider: "deepseek-web", model: "deepseek-chat" },
      credentials: { apiKey: `synthetic-${account}`, providerSpecificData: { strictProxy: true, connectionProxyEnabled: true, connectionProxyUrl: `http://synthetic-${account}:8080` } }, sourceFormatOverride: detectFormatByEndpoint(new URL(request.url).pathname, body),
      abortSignal: request.signal,
      clientRawRequest: { endpoint: new URL(request.url).pathname, body, headers: {} },
      log: { debug: mocks.log, info: mocks.log, warn: mocks.log, error: mocks.log },
    });
    routeResults.push(result);
    return result.response;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });


// Mocked network only; the public routes, translators, chatCore and bounded proof solver are real.
for (const [route, endpoint] of [[chatRoute, "/v1/chat/completions"], [messagesRoute, "/v1/messages"]]) {
  for (const stream of [false, true]) {
    for (const flag of [undefined, "false", "source"]) {
      it(`default public ${endpoint} stream=${stream} flag=${flag} binds two accounts and proof`, async () => {
        vi.stubEnv("DURINDOOR_DEEPSEEK_WEB_POW", flag);
        for (account of ["A", "B"]) {
          mocks.fetch.mockClear();
          const response = await route.POST(new Request(`https://gateway.test${endpoint}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: "ds-web/deepseek-chat", stream, max_tokens: 200, messages: [{ role: "user", content: "hi" }] }),
          }));
          expect(response.status).toBe(200);
          expect(await response.text()).toContain("回答 answer");
          expect(mocks.fetch).toHaveBeenCalledTimes(4);
          expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith("/chat/completion"))).toHaveLength(1);
          for (const [, init] of mocks.fetch.mock.calls) expect(init.proxyOptions).toMatchObject({ connectionProxyUrl: `http://synthetic-${account}:8080` });
        }
      });
    }
    for (const [name, make, status] of [
      ["auth", () => json({ code: 40003, msg: "synthetic-secret" }), 401],
      ["quota", () => json({ code: 40002, msg: "synthetic-secret" }), 429],
      ["nonstream JSON", () => json({ unexpected: "synthetic-secret" }), 502],
      ["truncated legacy", () => new Response(sse([{ choices: [{ delta: { content: "partial" } }] }])), 502],
      ["unknown submit", () => { throw new Error("synthetic-secret"); }, 502],
    ]) {
      it(`default public ${endpoint} stream=${stream} refuses ${name} safely`, async () => {
        completion = make;
        const response = await route.POST(new Request(`https://gateway.test${endpoint}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "ds-web/deepseek-chat", stream, max_tokens: 200, messages: [{ role: "user", content: "hi" }] }),
        }));
        expect(response.status).toBe(status);
        expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/synthetic-secret|access-synthetic|signature-/);
        expect(await response.text()).not.toMatch(/synthetic-secret|finish_reason|usage/);
        expect(mocks.fetch).toHaveBeenCalledTimes(4);
        if (status === 502) {
          const state = { excludeConnectionIds: new Set() };
          expect((await processAttemptResult({ provider: "deepseek-web" }, state,
            { credentials: { connectionId: "synthetic-A" } }, routeResults.at(-1))).kind).toBe("terminal");
          expect(state.excludeConnectionIds.size).toBe(0);
        }
      });
    }
  }
}

it("default solver preserves the pinned source vector and aborts occupied CPU work", async () => {
  expect(deepSeekHashV1("vector_42_3")).toBe("2ffed26ea9e1d6f4bbe49a266d98fe04ad9a5ad4c6d765862de8d18c513c3815");
  const controller = new AbortController();
  const pending = solveChallenge({ ...challenge(), challenge: "0".repeat(64), difficulty: 250000 }, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(JSON.parse(Buffer.from(await solveChallenge(challenge()), "base64")).answer).toBe(3);
});

for (const [route, endpoint] of [[chatRoute, "/v1/chat/completions"], [messagesRoute, "/v1/messages"]]) {
  for (const stream of [false, true]) {
    it(`default public ${endpoint} stream=${stream} aborts a stalled completion body`, async () => {
      const controller = new AbortController();
      completion = () => {
        queueMicrotask(() => controller.abort());
        return new Response(new ReadableStream({ start() {} }));
      };
      const response = await route.POST(new Request(`https://gateway.test${endpoint}`, {
        method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "ds-web/deepseek-chat", stream, max_tokens: 200, messages: [{ role: "user", content: "hi" }] }),
      }));
      expect(response.status).toBe(499);
      expect(await response.text()).not.toMatch(/finish_reason|usage/);
      expect(mocks.fetch).toHaveBeenCalledTimes(4);
      expect(executorResults.at(-1).claudeRequestScoped).toBe(true);
    });
  }
}

for (const [name, change] of [
  ["unsupported algorithm", { algorithm: "unknown" }],
  ["invalid challenge", { challenge: "invalid" }],
  ["solver failure", { challenge: "0".repeat(64), difficulty: 1 }],
]) {
  it(`default ${name} fails before the billable completion`, async () => {
    challengeReply = () => json({ data: { biz_data: { challenge: { ...challenge(), ...change } } } });
    const result = await new Executor().execute({ model: "deepseek-chat", stream: false,
      body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: "synthetic-A" } });
    expect(result.response.status).toBe(502);
    expect(await result.response.text()).not.toMatch(/finish_reason|usage|signature-/);
    expect(mocks.fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/v0/users/current", "/api/v0/chat_session/create", "/api/v0/chat/create_pow_challenge",
    ]);
  });
}

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
