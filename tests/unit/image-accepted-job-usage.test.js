import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085 / #1548: a provider-accepted async image job can bill even when DurinDoor
// never sees its terminal state. Real handler, core, adapter, policy and SQLite;
// only credentials, model parsing and the provider HTTP transport are synthetic.

const state = vi.hoisted(() => ({ credentials: vi.fn(), markUnavailable: vi.fn() }));
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
  getComboModels: async () => null,
  getComboCanonicalName: async () => null,
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: (model) => !model, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}) }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: false }) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
vi.mock("open-sse/handlers/imageProviders/_base.js", async (original) => ({ ...(await original()), POLL_INTERVAL_MS: 1 }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let originalEnv; let listeners; let adapter; let database; let handleImage; let policy;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY id");
const send = (controller = new AbortController()) => handleImage(new Request("http://localhost/v1/images/generations", {
  method: "POST", signal: controller.signal, body: JSON.stringify({ model: "runwayml/gen4_image", prompt: "fixture" }),
}));
const expectAcceptedUnknown = (row, connectionId = "account-a") => {
  expect(row).toMatchObject({ provider: "runwayml", model: "gen4_image", connectionId, apiKey: "job-secret", endpoint: "/v1/images/generations", status: "accepted", cost: null, promptTokens: 0, completionTokens: 0 });
  expect(JSON.parse(row.meta)).toMatchObject({ modality: "image", costStatus: "unknown", costSource: "accepted-job", jobState: "accepted", nativeUnits: {} });
};

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  originalEnv = Object.fromEntries(["HOME", "DATA_DIR", "TMPDIR", "TMP", "TEMP", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "image-accepted-job-"));
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

describe("accepted async image jobs without a terminal observation", () => {
  it("records a client abort during polling as accepted with unknown cost, not as spend or free", async () => {
    const controller = new AbortController();
    fetch.mockResolvedValueOnce(json({ id: "task-1" })).mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    const response = await send(controller);
    expect(response.status).toBe(499);
    expect(state.markUnavailable).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expectAcceptedUnknown(rows()[0]);
    expect(await database.getApiKeyUsageTotals("job-key")).toMatchObject({ totalRequests: 1, totalCost: 0, unknownCostRequests: 1 });
    const request = new Request("http://localhost/v1/images/generations", { method: "POST" });
    expect(await policy.enforceApiKeyModelPolicy(request, "runwayml/gen4_image", "job-secret")).toBeNull();
  });

  it("keeps the budget unknown even when an operator image tariff exists: nothing was measured", async () => {
    const { updatePricing } = await import("@/lib/db/repos/pricingRepo.js");
    await updatePricing({ runwayml: { gen4_image: { native: { unit: "image", rate: 0.5 } } } });
    const controller = new AbortController();
    fetch.mockResolvedValueOnce(json({ id: "task-1" })).mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    await send(controller);
    expectAcceptedUnknown(rows()[0]);
  });

  it("records nothing when the client aborts before the provider accepted the job", async () => {
    const controller = new AbortController();
    fetch.mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    expect((await send(controller)).status).toBe(499);
    expect(rows()).toEqual([]);
  });

  it("records a polling timeout once and keeps the normal failure handling", async () => {
    const now = Date.now();
    fetch.mockResolvedValueOnce(json({ id: "task-1" })).mockImplementationOnce(async () => {
      vi.spyOn(Date, "now").mockReturnValue(now + 600_000);
      return json({ status: "RUNNING" });
    });
    const response = await send();
    expect(response.status).toBe(502);
    expect(state.markUnavailable).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
    expectAcceptedUnknown(rows()[0]);
  });

  it("records the abandoned job and the fallback account's success as separate events", async () => {
    state.credentials.mockReset()
      .mockResolvedValueOnce({ connectionId: "account-a", apiKey: "a", connectionName: "A" })
      .mockResolvedValueOnce({ connectionId: "account-b", apiKey: "b", connectionName: "B" });
    state.markUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    fetch
      .mockResolvedValueOnce(json({ id: "task-1" })).mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json({ id: "task-2" })).mockResolvedValueOnce(json({ status: "SUCCEEDED", output: ["https://x.test/i.png"] }));
    expect((await send()).status).toBe(200);
    expect(rows()).toHaveLength(2);
    expectAcceptedUnknown(rows()[0], "account-a");
    expect(rows()[1]).toMatchObject({ connectionId: "account-b", status: "ok" });
  });

  it.each([
    ["provider reports failure", () => json({ status: "FAILED", failure: "nope" })],
    ["provider reports cancellation", () => json({ status: "CANCELLED" })],
  ])("consumes nothing when the %s", async (_name, poll) => {
    fetch.mockResolvedValueOnce(json({ id: "task-1" })).mockImplementationOnce(async () => poll());
    expect((await send()).status).toBe(502);
    expect(rows()).toEqual([]);
  });

  it("consumes nothing when the provider refuses the submission", async () => {
    fetch.mockResolvedValueOnce(json({ error: { message: "no" } }, 400));
    expect((await send()).status).toBe(400);
    expect(rows()).toEqual([]);
  });

  it("consumes nothing when an accepted response carries no job id", async () => {
    fetch.mockResolvedValueOnce(json({}));
    expect((await send()).status).toBe(502);
    expect(rows()).toEqual([]);
  });

  it("does not let a ledger failure replace the abort outcome", async () => {
    const controller = new AbortController();
    fetch.mockResolvedValueOnce(json({ id: "task-1" })).mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    adapter.run("DROP TABLE usageHistory");
    expect((await send(controller)).status).toBe(499);
  });
});
