import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory;
let originalDataDir;
let key;
let usage;
let database;
let adapter;
let processListeners;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];

beforeEach(async () => {
  processListeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalDataDir = process.env.DATA_DIR;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-native-usage-"));
  process.env.DATA_DIR = directory;
  delete global._dbAdapter;
  vi.resetModules();
  database = await import("@/lib/db/index.js");
  const driver = await import("@/lib/db/driver.js");
  adapter = await driver.getAdapter();
  const keys = await import("@/lib/db/repos/apiKeysRepo.js");
  key = await keys.createApiKey("Native quota", "fixture-machine", [], 8, null, { policy: { maxTokens: 8 } });
  usage = await import("@/sse/services/nativeUsage.js");
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!processListeners.get(signal).has(listener)) process.removeListener(signal, listener);
    }
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(directory, { recursive: true, force: true });
});

function responseFrom(source, contentType = "application/json", chunkSize = 8191) {
  const bytes = new TextEncoder().encode(source);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      const end = Math.min(bytes.length, offset + chunkSize);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  }), { headers: { "content-type": contentType } });
}

function observe(response, details = {}) {
  return usage.observeNativeResponse(response, {
    apiKey: key.key, provider: "openai", model: "gpt-4.1", connectionId: "fixture-account", endpoint: "/v1/responses",
    usageEventId: "native-operation-1", modality: "chat", nativeUnits: {},
    cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable", ...details,
  });
}

async function assertCommitted(tokens = 8) {
  expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalTokens: tokens, totalRequests: 1 });
  expect(adapter.get("SELECT usageEventId FROM usageHistory").usageEventId).toBe("native-operation-1");
  expect((await usage.nativeUsageAdmission(key.key))?.status).toBe(429);
}

describe("Gemini Live usage normalization", () => {
  it("normalizes Live usageMetadata counters", () => {
    expect(usage.nativeUsageFromValue({ usageMetadata: { promptTokenCount: 3, responseTokenCount: 5, totalTokenCount: 8 } })).toMatchObject({ input_tokens: 3, output_tokens: 5, total_tokens: 8 });
  });
});

describe("native usage framing and quota transitions", () => {
  it("preserves total-only and partial metrics without inventing token components", () => {
    expect(usage.nativeUsageFromValue({ usage: { total_tokens: 9 } })).toEqual({ total_tokens: 9 });
    expect(usage.nativeUsageFromValue({ usage: { total_tokens: 10, output_tokens: 4 } })).toEqual({ total_tokens: 10, output_tokens: 4 });
    expect(usage.nativeUsageFromValue({ usage: null })).toBeNull();
  });

  it.each(["root", "response", "data"])("charges only %s usage and retains the envelope id across output arrays", async (wrapper) => {
    const envelope = { id: "response-owner", status: "completed", output: [{ id: "tool-output", status: "completed", usage: { input_tokens: 999 }, content: [{ text: "x".repeat(1024 * 1024 + 9) }] }], usage: { input_tokens: 3, output_tokens: 5 } };
    const body = wrapper === "root" ? envelope : { type: "response.completed", [wrapper]: envelope };
    const delivered = await observe(responseFrom(JSON.stringify(body), "application/json", 113)).json();
    expect((wrapper === "root" ? delivered : delivered[wrapper]).id).toBe("response-owner");
    await assertCommitted();
  });

  it("accepts successful output spending the final allowance and denies the next request", async () => {
    const delivered = await observe(responseFrom(JSON.stringify({ id: "last-allowance", status: "completed", usage: { input_tokens: 3, output_tokens: 5 } }), "application/json", 1)).json();
    expect(delivered.id).toBe("last-allowance");
    await assertCommitted();
  });
  it("does not charge a terminal SSE event when the consumer cancels before clean EOF", async () => {
    const event = 'data: {"type":"response.completed","response":{"id":"cancel-before-eof","usage":{"input_tokens":3,"output_tokens":5}}}\n\n';
    const source = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(event)); },
    }), { headers: { "content-type": "text/event-stream" } });
    const reader = observe(source).body.getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toBe(event);
    await reader.cancel();
    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalTokens: 0, totalRequests: 0 });
  });
  it.each(["chat.completion.chunk", "chat.completion"])("does not charge %s usage before a consumer cancels", async (object) => {
    const event = `data: ${JSON.stringify({ id: "chat-cancel", object, choices: [], usage: { prompt_tokens: 3, completion_tokens: 5 } })}\n\n`;
    const source = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(event)); },
    }), { headers: { "content-type": "text/event-stream" } });
    const reader = observe(source).body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(event);
    await reader.cancel();
    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalTokens: 0, totalRequests: 0 });
  });

  it("accounts a large image-bearing terminal SSE event without assembling or dropping it", async () => {
    const event = { type: "response.completed", response: { id: "sse-owner", output: [{ id: "image-result", result: "x".repeat(1024 * 1024 + 3) }], usage: { input_tokens: 3, output_tokens: 5 } } };
    const source = `data: ${JSON.stringify(event)}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const delivered = await observe(responseFrom(source, "text/event-stream", 257)).text();
    expect(delivered.endsWith("data: [DONE]\r\n\r\n")).toBe(true);
    await assertCommitted();
  });

  it("merges Anthropic input and output usage across separate SSE messages", async () => {
    const source = 'event: message_start\ndata: {"type":"message_start","message":{"id":"anthropic-owner","usage":{"input_tokens":3}}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    await observe(responseFrom(source, "text/event-stream", 7), { provider: "anthropic", model: "claude-haiku-4-5", endpoint: "/v1/messages" }).text();
    await assertCommitted();
  });

  it.each([
    ["clean EOF without a terminal", ""],
    ["failed response", 'data: {"type":"response.failed"}\n\n'],
    ["error after completion", 'data: {"type":"response.completed"}\n\ndata: {"type":"error","error":{"message":"failed"}}\n\n'],
  ])("does not charge %s", async (_name, ending) => {
    const source = 'data: {"id":"partial","usage":{"input_tokens":3,"output_tokens":5}}\n\n' + ending;
    await observe(responseFrom(source, "text/event-stream", 7)).text();
    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalTokens: 0, totalRequests: 0 });
  });

  it("charges chat usage only after DONE and clean EOF", async () => {
    const source = 'data: {"id":"chat-owner","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":5}}\n\ndata: [DONE]\n\n';
    await observe(responseFrom(source, "text/event-stream", 7), { endpoint: "/v1/chat/completions" }).text();
    await assertCommitted();
  });

  it("does not turn malformed provider JSON into a successful unaccounted response", async () => {
    await expect(observe(responseFrom('{"id":"broken","usage":', "application/json", 3)).text()).rejects.toThrow();
    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalTokens: 0, totalRequests: 0 });
  });
});
