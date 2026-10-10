import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1085 acceptance: an async video job's authoritative cost is charged once
// across concurrent, repeated and restarted polls, and the committed spend then
// drives the real policy decision. Same synthetic transport harness as
// media-async-usage.test.js; real isolated SQLite.

const state = vi.hoisted(() => ({ keyId: "owner" }));
vi.mock("@/lib/localDb", async () => ({
  saveRequestUsage: async (event) => (await import("@/lib/db/repos/usageRepo.js")).saveRequestUsage(event),
  getSettings: async () => ({}),
  // Delegate to the real repository so the real policy enforcer sees the key
  // row this file seeds, exactly as media-handler-budget.test.js does.
  getApiKeyByKey: async (key) => (await import("@/lib/db/repos/apiKeysRepo.js")).getApiKeyByKey(key),
  getApiKeyUsageTotals: async (id) => (await import("@/lib/db/repos/apiKeyUsageTotalsRepo.js")).getApiKeyUsageTotals(id),
  getProviderConnectionById: async (id) => ({ id, provider: "xai" }),
  getApiKeyProviderConnectionIds: async () => [],
}));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: "owner-secret", auth: { ok: true, apiKeyId: state.keyId } }),
  hasValidCliToken: async () => false,
  getProviderCredentialsWithQuotaPreflight: vi.fn(async (_p, _e, _m, options) => ({ connectionId: options.strictConnectionId || "account-a", apiKey: "provider-secret" })),
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (model) => !model, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}),
  listMediaRouteCandidates: vi.fn(), providerOfModelId: vi.fn(), supportsVideoJobs: () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("@/sse/services/apiKeyPolicy.js", async (original) => ({ ...await original(), enforceApiKeyModelPolicy: vi.fn(async () => null) }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ execute: async () => ({ response: await fetch("https://video.example.test/generate") }) }) }));

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let directory; let previousDataDir; let previousEngine; let listeners; let adapter; let create; let poll;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const createRequest = () => new Request("http://localhost/v1/videos/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "xai/grok-imagine-video", prompt: "waves" }) });
const pollRequest = (jobId = "job-1") => new Request(`http://localhost/v1/videos/${jobId}`, { headers: { "x-9router-connection-id": "account-a" } });
const rows = () => adapter.all("SELECT * FROM usageHistory");
async function reload() {
  vi.resetModules();
  ({ handleVideoCreate: create, handleVideoGet: poll } = await import("@/sse/handlers/video.js"));
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
}
async function restart() {
  await global._dbAdapter.instance.close();
  delete global._dbAdapter;
  await reload();
}
async function submit(jobId = "job-1") {
  fetch.mockResolvedValueOnce(json({ request_id: jobId, status: "pending" }));
  expect((await create(createRequest(), "generations")).status).toBe(200);
}
async function decision(model = "xai/grok-imagine-video") {
  const { enforceApiKeyModelPolicy } = await vi.importActual("@/sse/services/apiKeyPolicy.js");
  return enforceApiKeyModelPolicy(new Request("http://localhost/v1/videos/generations"), model, "owner-secret");
}

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  previousDataDir = process.env.DATA_DIR;
  previousEngine = process.env.DURINDOOR_DATABASE_ENGINE;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-budget-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
    ["owner", "owner-secret", "Video budget", JSON.stringify({ maxCostUsd: 0.5 }), new Date().toISOString()]);
  await reload();
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
  if (previousEngine === undefined) delete process.env.DURINDOOR_DATABASE_ENGINE; else process.env.DURINDOOR_DATABASE_ENGINE = previousEngine;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("async video completion and the dollar budget", () => {
  it("charges authoritative cost once across concurrent, repeated and restarted polls, then denies", async () => {
    await submit();
    expect(await decision()).toBeNull();
    fetch.mockImplementation(async () => json({ status: "done", video: { duration: 5 }, usage: { cost_usd: 0.6 } }));
    await Promise.all([poll(pollRequest(), "job-1"), poll(pollRequest(), "job-1")]);
    await poll(pollRequest(), "job-1");
    await restart();
    await poll(pollRequest(), "job-1");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ cost: 0.6, connectionId: "account-a", apiKey: "owner-secret" });
    expect(JSON.parse(rows()[0].meta)).toMatchObject({ nativeUnits: { videoSeconds: 5 }, costStatus: "known" });
    const { getApiKeyUsageTotals } = await import("@/lib/db/repos/apiKeyUsageTotalsRepo.js");
    expect(await getApiKeyUsageTotals("owner")).toMatchObject({ totalRequests: 1, totalCost: 0.6 });
    const denied = await decision();
    expect(denied.status).toBe(429);
    expect((await denied.json()).error.message).toMatch(/cost limit reached/);
  });

  it("neither spends nor denies for pending, failed or cost-unknown jobs", async () => {
    // Each scenario owns its job: the first terminal observation wins and is
    // never replaced, so a shared job could not show all three states.
    await submit("job-pending");
    await submit("job-failed");
    await submit("job-unknown");
    fetch.mockResolvedValueOnce(json({ status: "pending" }));
    await poll(pollRequest("job-pending"), "job-pending");
    expect(rows()).toEqual([]);
    fetch.mockResolvedValueOnce(json({ status: "failed", video: { duration: 5 }, usage: { cost_usd: 9 } }));
    await poll(pollRequest("job-failed"), "job-failed");
    expect(rows()).toEqual([]);
    fetch.mockResolvedValueOnce(json({ status: "done", video: { duration: 5 } }));
    await poll(pollRequest("job-unknown"), "job-unknown");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBeNull();
    expect(JSON.parse(rows()[0].meta)).toMatchObject({ costStatus: "unknown" });
    expect(await decision()).toBeNull();
  });
});
