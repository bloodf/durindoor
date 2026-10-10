import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

const writes = vi.hoisted(() => []);
vi.mock("@/lib/usageDb.js", async () => {
  const database = await import("@/lib/db/index.js");
  return {
    ...database,
    appendRequestLog: vi.fn(async () => {}),
    saveRequestDetail: vi.fn(async () => {}),
    saveRequestUsage(entry) {
      const write = database.saveRequestUsage(entry);
      writes.push(write);
      return write;
    },
  };
});

const secret = "sk-chat-epoch-fixture";
const keyId = "chat-epoch-key";
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory;
let originalEnv;
let listeners;
let adapter;
let database;
let resolveClientApiKey;
let saveUsageStats;
let handleNonStreamingResponse;
let handleForcedSSEToJson;
let buildOnStreamComplete;

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-chat-epoch-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  vi.resetModules();
  writes.length = 0;
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run(
    "INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)",
    [keyId, secret, "Chat epoch fixture", new Date().toISOString()],
  );
  ({ resolveClientApiKey } = await import("@/sse/services/auth.js"));
  ({ saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js"));
  ({ handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js"));
  ({ handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js"));
  ({ buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js"));
});

afterEach(async () => {
  await Promise.allSettled(writes);
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
    }
  }
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

it("rejects old chat callbacks after import but commits newly admitted usage once", async () => {
  const admit = () => resolveClientApiKey(new Request("http://localhost/v1/chat/completions", {
    headers: { authorization: `Bearer ${secret}` },
  }), { required: true });
  const complete = (auth, usageEventId) => saveUsageStats({
    provider: "chat-epoch-fixture", model: "chat-model", apiKey: secret,
    tokens: { prompt_tokens: 7, completion_tokens: 3 },
    endpoint: "/v1/chat/completions", connectionId: "account-a",
    billingEpoch: auth.billingEpoch, usageEventId, silent: true,
  });
  const old = await admit();
  expect(old.auth.ok).toBe(true);
  expect(old.auth.billingEpoch).toBeNull();
  complete(old.auth, "before-import");
  await Promise.all(writes);
  expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 1, totalTokens: 10 });

  const { usageEventReceiptsVersion, usageEventReceipts, billingCutoverVersion, billingEpoch, ...legacy } = await database.exportDb();
  await database.importDb(legacy);
  const cutover = await database.exportDb();
  expect(cutover.billingEpoch).toEqual(expect.any(String));
  expect(cutover.billingEpoch).not.toBe(old.auth.billingEpoch);
  const before = adapter.all("SELECT * FROM usageHistory");
  complete(old.auth, "old-inflight");
  await Promise.all(writes);
  expect(adapter.all("SELECT * FROM usageHistory")).toEqual(before);
  expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 1, totalTokens: 10 });

  const fresh = await admit();
  expect(fresh.auth.billingEpoch).toEqual(expect.any(String));
  complete(fresh.auth, "new-request");
  complete(fresh.auth, "new-request");
  await Promise.all(writes);
  expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 2, totalTokens: 20 });
});

// Start the real handler before import, but release its provider body or terminal
// callback afterward. Retried attempts retain the same admission epoch and event ID.
function startCompletion(kind, auth, usageEventId) {
  const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 };
  const context = {
    provider: "chat-epoch-fixture", model: "chat-model", apiKey: secret,
    billingEpoch: auth.billingEpoch, usageEventId, connectionId: "account-a",
    body: { model: "chat-model", messages: [] }, stream: kind !== "json",
    sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
    requestStartTime: Date.now(), clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(), appendLog: vi.fn(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
  };
  if (kind.startsWith("stream-")) {
    const callbacks = buildOnStreamComplete(context);
    return async () => {
      if (kind === "stream-abandon") {
        callbacks.onStreamAbandoned("client disconnect", { content: "hello", usage });
      } else {
        callbacks.onStreamComplete({
          content: "hello",
          ...(kind === "stream-error" ? { upstreamError: { message: "provider failed" } } : {}),
        }, usage);
      }
    };
  }

  let controller;
  const providerResponse = new Response(new ReadableStream({
    start(value) { controller = value; },
  }), { headers: { "content-type": kind === "json" ? "application/json" : "text/event-stream" } });
  let raw;
  if (kind === "json") {
    raw = JSON.stringify({
      id: "chat-epoch", object: "chat.completion", model: "chat-model",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage,
    });
  } else if (kind === "responses-sse") {
    context.targetFormat = FORMATS.OPENAI_RESPONSES;
    raw = [
      ["response.created", { response: { id: "resp-epoch", created_at: 123 } }],
      ["response.output_item.done", { output_index: 0, item: {
        type: "message", id: "msg-epoch", role: "assistant", content: [{ type: "output_text", text: "hello" }],
      } }],
      ["response.completed", { response: { usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } } }],
    ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  } else {
    raw = [
      { choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
    ].map((data) => `data: ${JSON.stringify(data)}\n\n`).join("") + "data: [DONE]\n\n";
  }
  const pending = (kind === "json" ? handleNonStreamingResponse : handleForcedSSEToJson)({ ...context, providerResponse });
  return async () => {
    controller.enqueue(new TextEncoder().encode(raw));
    controller.close();
    const result = await pending;
    expect(result.success).toBe(true);
    await result.response.json();
  };
}

it.each(["json", "responses-sse", "chat-sse", "stream-success", "stream-error", "stream-abandon"])(
  "%s fences old in-flight usage and retries while admitting fresh usage once",
  async (kind) => {
    const admit = async () => {
      const { auth } = await resolveClientApiKey(new Request("http://localhost/v1/chat/completions", {
        headers: { authorization: `Bearer ${secret}` },
      }), { required: true });
      expect(auth.ok).toBe(true);
      return auth;
    };
    // A receipt-less empty backup does not rotate the epoch. Charge real usage
    // first so this fixture exercises the legacy billing cutover, not a restore.
    await startCompletion(kind, await admit(), "before-import")();
    await Promise.all(writes);
    expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({ totalRequests: 1, totalTokens: 10 });
    // Exercise both the initial null epoch and a stale non-null epoch.
    for (const cycle of [0, 1]) {
      const old = await admit();
      if (cycle === 0) expect(old.billingEpoch).toBeNull();
      else expect(old.billingEpoch).toEqual(expect.any(String));
      const finishOld = startCompletion(kind, old, `old-${cycle}`);
      // Remove all modern billing metadata, including the previous cutover
      // marker, which requires receipts and would not describe a legacy backup.
      const { usageEventReceiptsVersion, usageEventReceipts, billingCutoverVersion, billingEpoch, ...legacy } = await database.exportDb();
      await database.importDb(legacy);
      const cutover = await database.exportDb();
      expect(cutover.billingEpoch).toEqual(expect.any(String));
      expect(cutover.billingEpoch).not.toBe(old.billingEpoch);
      const before = adapter.all("SELECT * FROM usageHistory");
      const totals = await database.getApiKeyUsageTotals(keyId);
      await finishOld();
      await startCompletion(kind, old, `old-${cycle}`)();
      await Promise.all(writes);
      expect(adapter.all("SELECT * FROM usageHistory")).toEqual(before);
      expect(await database.getApiKeyUsageTotals(keyId)).toEqual(totals);

      const fresh = await admit();
      expect(fresh.billingEpoch).toEqual(expect.any(String));
      expect(fresh.billingEpoch).not.toBe(old.billingEpoch);
      await startCompletion(kind, fresh, `fresh-${cycle}`)();
      await startCompletion(kind, fresh, `fresh-${cycle}`)();
      await Promise.all(writes);
      expect(await database.getApiKeyUsageTotals(keyId)).toMatchObject({
        totalRequests: cycle + 2, totalTokens: (cycle + 2) * 10,
      });
    }
  },
);
