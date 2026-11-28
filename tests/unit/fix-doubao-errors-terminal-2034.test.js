/**
 * #2034 offline repairs: real executor, gateway, SQLite account/error and proxy paths.
 * Only network transport is scripted; all cookies are synthetic. No live parity claim.
 * Diagnostics deliberately omit the credential-bearing wire URL, headers and payload.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProxyAgent } from "undici";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";
import { DoubaoWebExecutor } from "../../open-sse/executors/doubao-web.js";

const accounts = ["alpha", "bravo"].map((name) => ({
  name, session: `synthetic-bare-session-${name}`, fp: `verify_synthetic_private_${name}`,
  proxy: `http://127.0.0.1:${name === "alpha" ? 19081 : 19082}`,
}));
const cookie = (a) => `sessionid=${a.session}; s_v_web_id=${a.fp}; ttwid=synthetic-ttwid-${a.name}`;
const frame = (text) => `event: MESSAGE_DELTA\ndata: ${JSON.stringify({ content: { content_block: [{ content: { text_block: { text } } }] } })}\n\n`;
const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });
const clean = (value) => {
  const text = JSON.stringify(value ?? null);
  for (const a of accounts) for (const secret of [a.session, a.fp, cookie(a)]) expect(text).not.toContain(secret);
};
let root, db, handleChat, restore, reply, wire, logs;
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "doubao-terminal-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected network"); }));
  const transport = await import("../../open-sse/utils/proxyFetch.js");
  restore = transport.__setOriginalFetchForTesting(async (url, init) => {
    wire.push({ url: String(url), init });
    return reply(String(url), init);
  });
  db = await import("@/lib/db/index.js");
  handleChat = (await import("../../src/sse/handlers/chat.js")).handleChat;
});
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const row of await db.getProviderConnections({})) await db.deleteProviderConnection(row.id);
  logs = []; wire = [];
  for (const method of ["log", "info", "warn", "error", "debug"]) vi.spyOn(console, method).mockImplementation((...args) => logs.push(args.map((value) => value instanceof Error ? value.stack : JSON.stringify(value) ?? String(value))));
  reply = () => { throw new Error("unscripted network"); };
});
afterAll(async () => {
  restore?.();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
async function pair() {
  return Promise.all(accounts.map((a, index) => db.createProviderConnection({
    provider: "doubao-web", authType: "cookie", name: a.name, apiKey: cookie(a), priority: index + 1,
    providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: a.proxy },
  })));
}
async function chat(anthropic, stream) {
  const endpoint = anthropic ? "/v1/messages" : "/v1/chat/completions";
  const response = await handleChat(new Request(`http://gateway.invalid${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json", ...(anthropic ? { "anthropic-version": "2023-06-01" } : {}) },
    body: JSON.stringify({ model: "doubao-web/dola-speed", max_tokens: 128, stream, messages: [{ role: "user", content: "hello" }] }),
  }));
  return { status: response.status, text: await response.text() };
}
async function assertAccounts(rows) {
  for (let index = 0; index < rows.length; index++) {
    const row = await db.getProviderConnectionById(rows[index].id);
    expect(row.apiKey).toBe(cookie(accounts[index]));
    expect(row.providerSpecificData).toEqual(rows[index].providerSpecificData);
    clean(row.lastError);
  }
  clean(logs);
}
const routes = [[false, false], [false, true], [true, false], [true, true]];
describe("Doubao safe gateway failures", () => {
  it.each(["bare", "full", "throw"].flatMap((kind) => routes.map(([anthropic, stream]) => [kind, anthropic, stream])))("never leaks %s echoes (Anthropic=%s stream=%s)", async (kind, anthropic, stream) => {
    const rows = await pair();
    reply = (url, init) => {
      const a = accounts.find((item) => init.headers.Cookie === cookie(item));
      const echo = kind === "bare" ? a.session : cookie(a);
      if (kind === "throw") throw new Error(`${echo} ${url}`);
      return new Response(echo, { status: 401 });
    };
    const result = await chat(anthropic, stream);
    expect(result.status).toBeGreaterThanOrEqual(400);
    clean(result); await assertAccounts(rows);
    expect(wire.length).toBeGreaterThanOrEqual(2);
    for (const { url, init } of wire) {
      const a = accounts.find((item) => init.headers.Cookie === cookie(item));
      expect(a).toBeDefined();
      expect(new URL(url).searchParams.get("fp")).toBe(a.fp);
      expect(init.dispatcher).toBeInstanceOf(ProxyAgent);
      // Undici keeps the selected URI on its own kProxy symbol; read only.
      const proxySymbol = Object.getOwnPropertySymbols(init.dispatcher).find((key) => key.description === "proxy agent options");
      expect(init.dispatcher[proxySymbol].uri).toBe(`${a.proxy}/`);
      expect(JSON.parse(init.body).ext.fp).toBe(a.fp);
    }
  });
  it.each(routes)("rejects failed generation without replay (Anthropic=%s stream=%s)", async (anthropic, stream) => {
    for (const tail of [
      'event: STREAM_ERROR\ndata: {"message":"synthetic-bare-session-alpha"}\n\n',
      'event: STREAM_END\ndata: {broken}\n\n',
      'event: STREAM_CHUNK\ndata: {',
      null,
    ]) {
      for (const row of await db.getProviderConnections({})) await db.deleteProviderConnection(row.id);
      const rows = await pair(); wire = [];
      reply = () => tail === null ? new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(frame("partial"))); },
        pull(controller) { controller.error(new Error(cookie(accounts[0]))); },
      }), { headers: { "content-type": "text/event-stream" } }) : sse(frame("partial") + tail);
      const result = await chat(anthropic, stream);
      expect(result.status).toBe(502);
      expect(result.text).toContain("error");
      expect(result.text).not.toContain('"stop"');
      expect(result.text).not.toContain('"end_turn"');
      expect(result.text).not.toContain('"usage"');
      expect(wire).toHaveLength(1);
      for (const row of rows) {
        const usage = await db.getUsageHistory({ connectionId: row.id });
        expect(usage.filter((entry) => entry.status === "success")).toEqual([]);
      }
      clean(result); await assertAccounts(rows);
    }
  });
  it.each(routes)("rejects HTML safely (Anthropic=%s stream=%s)", async (anthropic, stream) => {
    const rows = await pair();
    reply = () => new Response(`<html>${cookie(accounts[0])}</html>`, { headers: { "content-type": "text/html" } });
    const result = await chat(anthropic, stream);
    expect(result.status).toBe(502); expect(result.text).toContain("error");
    expect(wire.length).toBeGreaterThanOrEqual(1); clean(result); await assertAccounts(rows);
  });
  it.each(routes)("retains successful source frames (Anthropic=%s stream=%s)", async (anthropic, stream) => {
    await pair(); reply = () => sse(frame("source compatible"));
    const result = await chat(anthropic, stream);
    expect(result.status).toBe(200); expect(result.text).toContain("source compatible");
    if (!stream) expect(JSON.parse(result.text)).toHaveProperty(anthropic ? "type" : "choices");
    expect(wire).toHaveLength(1); clean([result, logs]);
  });
});
describe("Doubao actual executor boundary", () => {
  it.each([302, 401, 403, 429, 500])("keeps safe status evidence %s and hides wire metadata", async (status) => {
    let cancel = false;
    const executor = new DoubaoWebExecutor({ fetch: async () => new Response(new ReadableStream({
      cancel() { cancel = true; return new Promise(() => {}); },
    }), { status }) });
    const result = await executor.execute({ credentials: { apiKey: cookie(accounts[0]) }, body: {} });
    expect(result.response.status).toBe(status === 302 ? 401 : status);
    clean({ ...result, response: await result.response.text() });
    expect(cancel).toBe(true);
  });
  it("converts body transport throws into a safe failed turn", async () => {
    const executor = new DoubaoWebExecutor({ fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(frame("partial"))); },
      pull(controller) { controller.error(new Error(cookie(accounts[0]))); },
    }), { headers: { "content-type": "text/event-stream" } }) });
    const result = await executor.execute({ credentials: { apiKey: cookie(accounts[0]) }, body: {} });
    expect(result.response.status).toBe(502); expect(result.claudeRequestScoped).toBe(true);
    clean({ ...result, response: await result.response.text() });
  });
});

// Exercise the real opt-in request logger independently of the gateway's default
// disabled logger. Its directory is owned scratch, never the caller's data tree.
it("writes safe request diagnostics at the actual shared logger boundary", async () => {
  const previousCwd = process.cwd();
  vi.stubEnv("ENABLE_REQUEST_LOGS", "true");
  try {
    process.chdir(root);
    const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js?doubao-repair");
    const logger = await createRequestLogger("openai", "openai", "dola-speed");
    expect(logger.sessionPath).toBeTruthy();
    const executor = new DoubaoWebExecutor({ fetch: async () => new Response(cookie(accounts[0]), { status: 401 }) });
    const result = await executor.execute({ credentials: { apiKey: cookie(accounts[0]) }, body: {} });
    logger.logTargetRequest(result.url, result.headers, result.transformedBody);
    logger.logProviderResponse(result.response.status, "Rejected", {}, await result.response.text());
    const files = fs.readdirSync(logger.sessionPath);
    expect(files).toContain("4_req_target.json");
    for (const file of files) clean(fs.readFileSync(path.join(logger.sessionPath, file), "utf8"));
  } finally {
    process.chdir(previousCwd);
    vi.stubEnv("ENABLE_REQUEST_LOGS", undefined);
  }
});

it("bounds submission when the transport ignores its abort signal", async () => {
  const executor = new DoubaoWebExecutor({ fetch: () => new Promise(() => {}) });
  const result = await executor.execute({ credentials: { apiKey: cookie(accounts[0]) }, body: {}, requestPolicy: { headerTimeoutMs: 20 } });
  expect(result.response.status).toBe(502);
  clean({ ...result, response: await result.response.text() });
});
it("bounds body reads and cancellation even when neither settles", async () => {
  const { PROVIDER_BODY_TIMEOUT_MS } = await import("../../open-sse/config/runtimeConfig.js");
  let cancelled = false;
  const executor = new DoubaoWebExecutor({ fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(frame("partial"))); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }), { headers: { "content-type": "text/event-stream" } }) });
  vi.useFakeTimers();
  try {
    const pending = executor.execute({ credentials: { apiKey: cookie(accounts[0]) }, body: {} });
    await vi.advanceTimersByTimeAsync(PROVIDER_BODY_TIMEOUT_MS + 1);
    const result = await pending;
    expect(result.response.status).toBe(502);
    expect(result.claudeRequestScoped).toBe(true);
    expect(cancelled).toBe(true);
    clean({ ...result, response: await result.response.text() });
  } finally { vi.useRealTimers(); }
});

it("retains safe quota timing without echoed upstream headers", async () => {
  const executor = new DoubaoWebExecutor({ fetch: async () => new Response(cookie(accounts[0]), {
    status: 429, headers: { "retry-after": "37", "x-debug": cookie(accounts[0]) },
  }) });
  const result = await executor.execute({ credentials: { apiKey: cookie(accounts[0]) }, body: {} });
  expect(result.response.status).toBe(429);
  expect(result.response.headers.get("retry-after")).toBe("37");
  clean({ ...result, response: await result.response.text() });
});

it("rejects a 200 HTML document at the executor boundary", async () => {
  const executor = new DoubaoWebExecutor({ fetch: async () => new Response(`<html>${cookie(accounts[0])}</html>`, {
    headers: { "content-type": "text/html" },
  }) });
  const result = await executor.execute({ credentials: { apiKey: cookie(accounts[0]) }, body: {} });
  expect(result.response.status).toBe(502);
  clean({ ...result, response: await result.response.text() });
});
