import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeTransport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: nativeTransport.fetch }));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: (request) => request.headers.get("authorization")?.replace(/^Bearer /, ""),
  hasValidCliToken: async () => false,
  resolveClientApiKey: async (request) => ({ apiKey: request.headers.get("authorization")?.replace(/^Bearer /, ""), auth: { ok: true, apiKeyId: "native-fixture" } }),
  getProviderCredentialsWithQuotaPreflight: async () => ({ connectionId: "fixture-account", apiKey: "fixture-provider", providerSpecificData: {} }),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (identity) => ({ provider: identity.split("/")[0], model: identity.slice(identity.indexOf("/") + 1) }),
}));

let directory;
let originalDataDir;
let key;
let database;
let processListeners;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];

beforeEach(async () => {
  processListeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalDataDir = process.env.DATA_DIR;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-native-streaming-quota-"));
  process.env.DATA_DIR = directory;
  delete global._dbAdapter;
  vi.resetModules();
  database = await import("@/lib/db/index.js");
  await (await import("@/lib/db/driver.js")).getAdapter();
  key = await (await import("@/lib/db/repos/apiKeysRepo.js")).createApiKey("Native quota", "fixture-machine", [], 8, null, { policy: { maxTokens: 8 } });
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

describe("native streaming quota enforcement", () => {
  it.each([
    ["openai", "/v1/chat/completions", "gpt-4.1"],
    ["minimax", "/v1/chat/completions", "MiniMax-M3.1-Flash-Preview"],
    ["minimax", "/v1/text/chatcompletion_v2", "MiniMax-M3.1-Flash-Preview"],
    ["minimax-cn", "/v1/text/chatcompletion_v2", "MiniMax-M3.1-Flash-Preview"],
  ])("enforces the last allowance when %s %s client suppresses stream usage", async (provider, operation, model) => {
    nativeTransport.fetch.mockImplementation(async (_url, options) => {
      const sent = JSON.parse(options.body);
      const value = { id: "usage-cannot-be-suppressed", object: "chat.completion.chunk", choices: [], usage: sent.stream_options?.include_usage === true ? { prompt_tokens: 3, completion_tokens: 5 } : null };
      return new Response(`data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const { handleNativeProvider } = await import("@/sse/handlers/nativeProvider.js");
    const request = () => new Request(`http://local/v1/native/${provider}${operation}`, {
      method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: `${provider}/${model}`, stream: true, stream_options: { include_usage: false }, messages: [{ role: "user", content: "x" }] }),
    });
    const result = await handleNativeProvider(request(), provider, operation);
    expect(result.status).toBe(200);
    await result.text();
    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalTokens: 8, totalRequests: 1 });
    expect((await handleNativeProvider(request(), provider, operation)).status).toBe(429);
  });
});
