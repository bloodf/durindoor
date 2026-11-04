import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ models: [], penalty: vi.fn() }));
vi.mock("@/lib/localDb", async () => ({
  saveRequestUsage: (...args) => import("@/lib/db/repos/usageRepo.js").then((repo) => repo.saveRequestUsage(...args)),
  getSettings: async () => ({}),
  getApiKeyByKey: async () => null,
}));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "key", auth: { ok: true, apiKeyId: "key-id" } }),
  getNoAuthProviderCredentials: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async () => ({ apiKey: "provider-key", connectionId: "account" })),
  markAccountUnavailable: state.penalty,
  clearAccountError: vi.fn(),
  hasValidCliToken: async () => false,
  extractApiKey: () => null,
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, model] = value.split("/"); return { provider, model }; },
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: vi.fn() }));
vi.mock("@/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (model) => !model,
  resolveMediaRoute: async () => ({ models: state.models }),
  defaultRouteComboOptions: () => ({ checkEmptyBody: false, autoSwitch: false }),
  supportsTranslation: () => true,
}));
vi.mock("@/sse/services/apiKeyPolicy.js", async (original) => ({
  ...await original(),
  enforceApiKeyModelPolicy: async () => null,
}));
vi.mock("@/sse/utils/requestCorrelation.js", () => ({
  captureRequestBillingEpoch: async () => {}, getRequestId: () => "request", withRequestCorrelation: (handler) => handler,
}));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "test" }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));

let handleStt;
let adapter;
let directory;
let previousDataDir;
let previousEngine;
let listeners;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY timestamp");
const metadata = (row) => JSON.parse(row.meta);

function request(model) {
  const body = new FormData();
  if (model) body.set("model", model);
  body.set("file", new Blob(["audio"], { type: "audio/wav" }), "audio.wav");
  return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body });
}

const malformed = ["<html>error</html>", "null", JSON.stringify({ usage: "invalid" })];
beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  previousDataDir = process.env.DATA_DIR;
  previousEngine = process.env.DURINDOOR_DATABASE_ENGINE;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepgram-ledger-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("Network disabled in test"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected fetch"); }));
  state.penalty.mockResolvedValue({ shouldFallback: false });
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)", ["key-id", "key", "test", new Date().toISOString()]);
  ({ handleStt } = await import("@/sse/handlers/stt.js"));
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
  if (previousEngine === undefined) delete process.env.DURINDOOR_DATABASE_ENGINE; else process.env.DURINDOOR_DATABASE_ENGINE = previousEngine;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("accepted Deepgram responses", () => {
  it.each(malformed)("records malformed body %s in direct handler", async (body) => {
    fetch.mockResolvedValue(new Response(body));
    const response = await handleStt(request("deepgram/nova-3"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ provider: "deepgram", model: "nova-3", cost: null });
    expect(metadata(rows()[0])).toMatchObject({ nativeUnits: {}, costStatus: "unknown" });
    expect(state.penalty).not.toHaveBeenCalled();
  });

  it.each(malformed.flatMap((body) => [[body, ["deepgram/nova-3", "openai/whisper-1"]], [body, ["deepgram/nova-3", "deepgram/nova-2"]]]))(
    "does not retry malformed body %s in combo %j", async (body, models) => {
      state.models = models;
      fetch.mockResolvedValue(new Response(body));
      const response = await handleStt(request());
      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledOnce();
      expect(await response.json()).toEqual({ text: "" });
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ provider: "deepgram", model: "nova-3", cost: null });
      expect(metadata(rows()[0])).toMatchObject({ nativeUnits: {}, costStatus: "unknown" });
      expect(state.penalty).not.toHaveBeenCalled();
    },
  );

  it("falls back on a genuine upstream 500", async () => {
    state.models = ["deepgram/nova-3", "openai/whisper-1"];
    state.penalty.mockResolvedValue({ shouldFallback: false });
    fetch.mockResolvedValueOnce(new Response("upstream failure", { status: 500 }))
      .mockResolvedValueOnce(Response.json({ text: "fallback" }));
    const response = await handleStt(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "fallback" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.penalty).toHaveBeenCalledOnce();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ provider: "openai" });
  });
});
