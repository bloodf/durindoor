import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// #2647 review follow-up: receipts already read from a Codex image response must
// survive the cancel, whoever ended the read. A `tool_usage.image_gen` count with
// no general usage is a receipt (kept as metadata, never host-model tokens), and
// an upstream AbortError while the client is still connected keeps the receipt
// and the usual health/fallback handling. Real handlers, cores, adapters, policy
// and SQLite; only credentials, model parsing and the HTTP transport are stubs.

const state = vi.hoisted(() => ({ credentials: vi.fn(), markUnavailable: vi.fn(), combo: null }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "job-secret", auth: { ok: true, apiKeyId: "job-key" } }),
  hasValidCliToken: async () => false,
  extractApiKey: () => "job-secret",
  getProviderCredentialsWithQuotaPreflight: (...args) => state.credentials(...args),
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: (...args) => state.markUnavailable(...args),
  clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
  getComboModels: async () => state.combo,
  getComboCanonicalName: async () => (state.combo ? "image-combo" : null),
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: (model) => !model, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
vi.mock("open-sse/handlers/imageProviders/_base.js", async (original) => ({ ...(await original()), POLL_INTERVAL_MS: 1 }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let adapter; let database; let handleImage; let policy;
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY id");

// Transforming the handler, DB and policy graph is the slow part. Warm it once so
// beforeEach keeps the default hook timeout and a real hang still fails.
beforeAll(async () => {
  const before = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  const env = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  const warm = fs.mkdtempSync(path.join(os.tmpdir(), "codex-image-receipts-warm-"));
  process.env.DATA_DIR = warm;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  try {
    await import("@/lib/db/index.js");
    await import("@/sse/handlers/imageGeneration.js");
    await import("@/sse/services/apiKeyPolicy.js");
    await import("@/lib/db/repos/monitoringUsageRepo.js");
  } finally {
    await global._dbAdapter?.instance?.close?.();
    delete global._dbAdapter;
    for (const signal of signals) for (const listener of process.listeners(signal)) if (!before.get(signal).has(listener)) process.removeListener(signal, listener);
    for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    fs.rmSync(warm, { recursive: true, force: true });
  }
}, 60_000);

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["HOME", "DATA_DIR", "TMPDIR", "TMP", "TEMP", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-image-receipts-"));
  for (const name of ["home", "data", "tmp"]) fs.mkdirSync(path.join(directory, name));
  process.env.HOME = path.join(directory, "home");
  process.env.DATA_DIR = path.join(directory, "data");
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = path.join(directory, "tmp");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  vi.clearAllMocks();
  state.credentials.mockReset().mockResolvedValue({ connectionId: "account-a", apiKey: "provider-secret", connectionName: "A" });
  state.markUnavailable.mockReset().mockResolvedValue({ shouldFallback: false });
  state.combo = null;
  vi.stubGlobal("fetch", vi.fn());
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    ["job-key", "job-secret", "Accepted jobs", JSON.stringify({ maxCostUsd: 0.5 }), new Date().toISOString()]);
  ({ handleImageGeneration: handleImage } = await import("@/sse/handlers/imageGeneration.js"));
  policy = await import("@/sse/services/apiKeyPolicy.js");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  for (const [name, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});

const enc = (text) => new TextEncoder().encode(text);
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const USAGE = { input_tokens: 9, output_tokens: 4, total_tokens: 13 };
const TOOL = { image_gen: { input_tokens: 7, output_tokens: 3 } };
const toolOnly = sse("response.in_progress", { response: { status: "in_progress", tool_usage: TOOL } });
const withUsage = sse("response.in_progress", { response: { status: "in_progress", usage: USAGE } });
const completed = sse("response.completed", {
  response: { status: "completed", usage: USAGE, tool_usage: TOOL, output: [{ type: "image_generation_call", result: "aGk=" }] },
});
const CODEX = "codex/gpt-5.4-image";

/** A 2xx body that sends `chunks`, then errors the way `end` says. */
const body = (chunks, end) => async (_url, { signal }) => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(enc(chunk));
    signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    end?.(controller);
  },
}), { status: 200, headers: { "Content-Type": "text/event-stream" } });
// The client leaves once headers are out.
const clientLeaves = (client) => () => setTimeout(() => client.abort(), 5);
// The upstream connection aborts on its own; the client stays connected.
const upstreamAborts = (controller) => setTimeout(() => controller.error(new DOMException("upstream reset", "AbortError")), 5);
const generate = (controller, headers = {}) => handleImage(new Request("http://localhost/v1/images/generations", {
  method: "POST", signal: controller?.signal, headers, body: JSON.stringify({ model: CODEX, prompt: "fixture" }),
}));
const meta = (row) => JSON.parse(row.meta);
const expectToolOnlyRow = (row, cause) => {
  expect(row).toMatchObject({ provider: "codex", status: "cancelled", cost: null, promptTokens: 0, completionTokens: 0, connectionId: "account-a", apiKeyId: "job-key" });
  expect(meta(row)).toMatchObject({ costStatus: "unknown", nativeUnits: {}, imageToolUsage: { input_tokens: 7, output_tokens: 3 }, ...cause });
  expect(meta(row).nativeUnitsSource).toBeUndefined();
  expect(row.meta).not.toContain("provider-secret");
};
const CLIENT = { clientCancelled: "after-upstream-headers", costSource: "client-cancelled" };
const UPSTREAM = { upstreamAborted: "after-upstream-headers", costSource: "upstream-aborted" };

beforeEach(() => {
  state.credentials.mockResolvedValue({ connectionId: "account-a", accessToken: "provider-secret", connectionName: "A" });
});

describe("tool_usage.image_gen without general usage is a receipt", () => {
  it("buffered: a client cancel keeps the image-tool counts as metadata only", async () => {
    const client = new AbortController();
    fetch.mockImplementationOnce(body([toolOnly], clientLeaves(client)));
    expect((await generate(client)).status).toBe(499);
    expect(rows()).toHaveLength(1);
    expectToolOnlyRow(rows()[0], CLIENT);
    expect(state.markUnavailable).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await database.getApiKeyUsageTotals("job-key")).toMatchObject({ totalRequests: 1, totalCost: 0, unknownCostRequests: 1 });
  });

  it("client stream: a reader cancel keeps the image-tool counts as metadata only", async () => {
    fetch.mockImplementationOnce(body([toolOnly]));
    const response = await generate(undefined, { accept: "text/event-stream" });
    expect(response.status).toBe(200);
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel("client left");
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expectToolOnlyRow(rows()[0], CLIENT);
    expect(state.markUnavailable).not.toHaveBeenCalled();
  });

  it("a native per-image tariff does not price a cancel that returned no image", async () => {
    const { updatePricing } = await import("@/lib/db/repos/pricingRepo.js");
    await updatePricing({ codex: { "gpt-5.4-image": { native: { unit: "image", rate: 0.5 } } } });
    const client = new AbortController();
    fetch.mockImplementationOnce(body([toolOnly], clientLeaves(client)));
    expect((await generate(client)).status).toBe(499);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ cost: null, promptTokens: 0, completionTokens: 0 });
    expect(await database.getApiKeyUsageTotals("job-key")).toMatchObject({ totalCost: 0 });
  });

  it("success keeps the general usage as tokens and the tool counts as metadata", async () => {
    fetch.mockImplementationOnce(body([completed]));
    expect((await generate()).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "ok", promptTokens: 9, completionTokens: 4 });
    expect(meta(rows()[0])).toMatchObject({ imageToolUsage: { input_tokens: 7, output_tokens: 3 }, nativeUnits: { images: 1 } });
  });
});

describe("upstream AbortError with a live client keeps the observed receipt", () => {
  for (const [name, chunk, expectRow] of [
    ["a usage receipt", withUsage, (row) => {
      expect(row).toMatchObject({ status: "cancelled", promptTokens: 9, completionTokens: 4, cost: null });
      expect(meta(row)).toMatchObject({ ...UPSTREAM, nativeUnits: {} });
      expect(meta(row).clientCancelled).toBeUndefined();
    }],
    ["an image-tool receipt", toolOnly, (row) => expectToolOnlyRow(row, UPSTREAM)],
  ]) {
    it(`buffered: records ${name} and keeps the 499 account-health path`, async () => {
      fetch.mockImplementationOnce(body([chunk], upstreamAborts));
      const response = await generate(new AbortController());
      expect(response.status).toBe(499);
      expect(rows()).toHaveLength(1);
      expectRow(rows()[0]);
      // Not a client cancel: account health still sees the failure.
      expect(state.markUnavailable).toHaveBeenCalledTimes(1);
      expect(state.markUnavailable.mock.calls[0].slice(0, 2)).toEqual(["account-a", 499]);
    });
  }

  it("buffered: fallback still runs, and each attempted account records its own receipt once", async () => {
    state.credentials
      .mockResolvedValueOnce({ connectionId: "account-a", accessToken: "provider-secret", connectionName: "A" })
      .mockResolvedValueOnce({ connectionId: "account-b", accessToken: "provider-secret-b", connectionName: "B" });
    state.markUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    fetch.mockImplementationOnce(body([withUsage], upstreamAborts)).mockImplementationOnce(body([completed]));
    expect((await generate(new AbortController())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rows().map((row) => [row.connectionId, row.status])).toEqual([["account-a", "cancelled"], ["account-b", "ok"]]);
    expect(await database.getApiKeyUsageTotals("job-key")).toMatchObject({ totalRequests: 2 });
  });

  it("buffered: no receipt read records nothing and keeps the health path", async () => {
    fetch.mockImplementationOnce(body([sse("response.created", { response: { status: "in_progress" } })], upstreamAborts));
    expect((await generate(new AbortController())).status).toBe(499);
    expect(rows()).toHaveLength(0);
    expect(await database.getApiKeyUsageTotals("job-key")).toMatchObject({ totalRequests: 0, unknownCostRequests: 0 });
    expect(state.markUnavailable).toHaveBeenCalledTimes(1);
  });

  it("client stream: records the receipt tagged upstream, with an in-band error", async () => {
    fetch.mockImplementationOnce(body([toolOnly], upstreamAborts));
    const response = await generate(undefined, { accept: "text/event-stream" });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("event: error");
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expectToolOnlyRow(rows()[0], UPSTREAM);
  });
});
