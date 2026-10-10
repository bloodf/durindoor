import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ keyId: "owner", connectionId: "account-a", allowed: [], denied: false, failLedger: false }));
vi.mock("@/lib/localDb", async () => ({
  saveRequestUsage: async (event) => {
    if (state.failLedger) throw new Error("ledger unavailable");
    return (await import("@/lib/db/repos/usageRepo.js")).saveRequestUsage(event);
  },
  getSettings: async () => ({}),
  getApiKeyByKey: async () => null,
  getProviderConnectionById: async (id) => ({ id, provider: "xai" }),
  getApiKeyProviderConnectionIds: async () => state.allowed,
}));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: async () => ({ apiKey: state.keyId ? `${state.keyId}-secret` : null, auth: { ok: true, apiKeyId: state.keyId } }),
  hasValidCliToken: async () => false,
  getProviderCredentialsWithQuotaPreflight: vi.fn(async (_provider, _excluded, _model, options) => ({ connectionId: options.strictConnectionId || state.connectionId, apiKey: "provider-secret" })),
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = value.split("/"); return { provider, model: model.join("/") }; },
}));
vi.mock("@/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: (model) => !model, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}),
  listMediaRouteCandidates: vi.fn(), providerOfModelId: vi.fn(), supportsVideoJobs: () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_provider, credentials) => credentials, updateProviderCredentials: vi.fn() }));
vi.mock("@/sse/services/apiKeyPolicy.js", async (original) => ({
  ...await original(), enforceApiKeyModelPolicy: vi.fn(async () => state.denied ? new Response("Denied", { status: 403 }) : null),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetch(...args) }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ execute: async () => ({ response: await fetch("https://video.example.test/generate") }) }) }));

let directory;
let previousDataDir;
let previousEngine;
let listeners;
let adapter;
let create;
let poll;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
let generate;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const createRequest = () => new Request("http://localhost/v1/videos/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "xai/grok-imagine-video", prompt: "waves", duration: 99 }) });
const pollRequest = (connectionId = "account-a") => new Request("http://localhost/v1/videos/shared-id", { headers: connectionId ? { "x-9router-connection-id": connectionId } : {} });
const rows = () => adapter.all("SELECT * FROM usageHistory");
async function submit() {
  fetch.mockResolvedValueOnce(json({ request_id: "shared-id", status: "pending" }));
  expect((await create(createRequest(), "generations")).status).toBe(200);
}
async function reload() {
  vi.resetModules();
  ({ handleVideoCreate: create, handleVideoGet: poll, handleVideoGeneration: generate } = await import("@/sse/handlers/video.js"));
}


async function importCutover() {
  const { exportDb, importDb } = await import("@/lib/db/index.js");
  const backup = await exportDb();
  await importDb({ ...backup, billingCutoverVersion: 1, billingEpoch: backup.billingEpoch || "imported-generation" });
}
beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  previousDataDir = process.env.DATA_DIR;
  previousEngine = process.env.DURINDOOR_DATABASE_ENGINE;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-usage-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(state, { keyId: "owner", connectionId: "account-a", allowed: [], denied: false, failLedger: false });
  vi.stubGlobal("fetch", vi.fn());
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)", ["owner", "owner-secret", "Video test", new Date().toISOString()]);
  await reload();
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
  if (previousEngine === undefined) delete process.env.DURINDOOR_DATABASE_ENGINE; else process.env.DURINDOOR_DATABASE_ENGINE = previousEngine;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("durable video jobs use the existing ledger", () => {
  it("rejects old jobs before upstream dispatch after import, then bills new jobs once", async () => {
    await submit();
    await importCutover();
    fetch.mockClear();
    expect((await poll(pollRequest(), "shared-id")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    await submit();
    fetch.mockResolvedValueOnce(json({ status: "done", video: { duration: 3 }, usage: { cost_usd: 0.2 } }));
    expect((await poll(pollRequest(), "shared-id")).status).toBe(200);
    expect((await poll(pollRequest(), "shared-id")).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBe(0.2);
  });

  it.each(["create", "poll", "direct"])("does not upgrade an in-flight %s completion across import", async (operation) => {
    await importCutover();
    if (operation === "poll") await submit();
    fetch.mockImplementationOnce(async () => {
      await importCutover();
      return json(operation === "create" ? { request_id: "shared-id", status: "pending" } :
        { status: "done", video: { duration: 3 }, usage: { cost_usd: 0.2 } });
    });
    const directRequest = () => new Request("http://localhost/v1/video/generations", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "veoaifree-web/video", prompt: "waves" }),
    });
    const response = operation === "create" ? await create(createRequest(), "generations") :
      operation === "poll" ? await poll(pollRequest(), "shared-id") : await generate(directRequest());
    expect(response.status).toBe(500);
    expect(rows()).toEqual([]);
    expect(adapter.all("SELECT value FROM kv WHERE scope = 'mediaJobs'")).toEqual([]);
    if (operation === "direct") {
      fetch.mockResolvedValueOnce(json({ video: { duration: 3 }, usage: { cost_usd: 0.2 } }));
      expect((await generate(directRequest())).status).toBe(200);
      expect(rows()).toHaveLength(1);
      expect(rows()[0].cost).toBe(0.2);
    }
  });

  it("records no submission usage or secret, then deduplicates concurrent and restarted completion polls", async () => {
    await submit();
    expect(rows()).toEqual([]);
    const stored = adapter.get("SELECT value FROM kv WHERE scope = 'mediaJobs'").value;
    expect(stored).not.toContain("secret");
    expect(JSON.parse(stored)).toMatchObject({ apiKeyId: "owner", connectionId: "account-a", model: "grok-imagine-video" });
    fetch.mockImplementation(async () => json({ status: "done", video: { url: "https://example.test/video", duration: 4.5 } }));
    await Promise.all([poll(pollRequest(), "shared-id"), poll(pollRequest(), "shared-id")]);
    await global._dbAdapter.instance.close();
    delete global._dbAdapter;
    await reload();
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    await poll(pollRequest(), "shared-id");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ cost: null, promptTokens: 0, completionTokens: 0, connectionId: "account-a", apiKey: "owner-secret" });
    expect(JSON.parse(rows()[0].meta)).toMatchObject({ nativeUnits: { videoSeconds: 4.5 }, costStatus: "unknown" });
    const { getApiKeyUsageTotals } = await import("@/lib/db/repos/apiKeyUsageTotalsRepo.js");
    expect(await getApiKeyUsageTotals("owner")).toMatchObject({ totalRequests: 1 });
  });

  it.each(["prune", "all"])("does not recharge durable terminal jobs after %s and restart", async (mode) => {
    await submit();
    const terminal = { status: "done", video: { duration: 6 }, usage: { cost_usd: 0.4 } };
    fetch.mockResolvedValueOnce(json(terminal));
    expect((await poll(pollRequest(), "shared-id")).status).toBe(200);
    const { pruneUsageOlderThan, resetUsageHistory } = await import("@/lib/db/repos/usageRepo.js");
    if (mode === "prune") await pruneUsageOlderThan(Date.now() + 1000);
    else await resetUsageHistory("all");
    expect(rows()).toEqual([]);
    await global._dbAdapter.instance.close();
    delete global._dbAdapter;
    await reload();
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    fetch.mockReset();
    fetch.mockRejectedValue(new Error("upstream expired"));
    const replay = await poll(pollRequest(), "shared-id");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(terminal);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    const { getApiKeyUsageTotals } = await import("@/lib/db/repos/apiKeyUsageTotalsRepo.js");
    expect(await getApiKeyUsageTotals("owner")).toMatchObject({ totalRequests: 1, totalCost: 0.4 });
  });

  it("recovers a terminal observation whose ledger commit failed, even when upstream has expired", async () => {
    await submit();
    const terminalBody = { status: "done", video: { duration: 6 }, usage: { cost_usd: 0.4 } };
    fetch.mockResolvedValueOnce(json(terminalBody));
    state.failLedger = true;
    const failed = await poll(pollRequest(), "shared-id");
    expect(failed.status).toBe(500);
    const failedBody = await failed.json();
    expect(failedBody).toMatchObject({ error: { type: "server_error", code: "internal_server_error" } });
    expect(JSON.stringify(failedBody)).not.toContain("ledger unavailable");
    expect(rows()).toEqual([]);
    const stored = adapter.get("SELECT key, value FROM kv WHERE scope = 'mediaJobs'");
    const observed = JSON.parse(stored.value);
    expect(JSON.parse(stored.key)).toEqual(["video", "xai", "account-a", "shared-id"]);
    expect(observed).toMatchObject({
      apiKeyId: "owner", connectionId: "account-a", resourceId: "shared-id",
      terminal: { status: "succeeded", cost: 0.4, response: { status: 200 } },
    });
    expect(JSON.parse(observed.terminal.response.body)).toEqual(terminalBody);
    await global._dbAdapter.instance.close();
    delete global._dbAdapter;
    await reload();
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(adapter.get("SELECT key, value FROM kv WHERE scope = 'mediaJobs'")).toEqual(stored);
    fetch.mockReset();
    fetch.mockRejectedValue(new Error("upstream expired"));
    expect((await poll(pollRequest(), "shared-id")).status).toBe(500);
    expect(rows()).toEqual([]);
    expect(adapter.get("SELECT value FROM kv WHERE scope = 'mediaJobs'").value).toBe(stored.value);
    state.failLedger = false;
    const replay = await poll(pollRequest(), "shared-id");
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-9router-connection-id")).toBe("account-a");
    expect(await replay.json()).toEqual(terminalBody);
    expect((await poll(pollRequest(), "shared-id")).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost).toBe(0.4);
    expect(rows()[0].usageEventId).toBe(observed.usageEventId);
    expect(adapter.get("SELECT value FROM kv WHERE scope = 'mediaJobs'").value).toBe(stored.value);
  });

  it("fails closed for absent ownership, different callers, revoked connection scope and current model ACL", async () => {
    await submit();
    fetch.mockClear();
    state.keyId = "other";
    expect((await poll(pollRequest(), "shared-id")).status).toBe(404);
    state.keyId = "owner";
    expect((await poll(pollRequest(), "unknown")).status).toBe(404);
    expect((await poll(pollRequest(null), "shared-id")).status).toBe(403);
    state.allowed = ["account-b"];
    expect((await poll(pollRequest(), "shared-id")).status).toBe(403);
    state.allowed = []; state.denied = true;
    expect((await poll(pollRequest(), "shared-id")).status).toBe(403);
    state.denied = false; state.keyId = null;
    expect((await create(createRequest(), "generations")).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  it("separates identical upstream IDs by original connection and never rotates a poll", async () => {
    await submit();
    state.connectionId = "account-b";
    await submit();
    fetch.mockImplementation(async () => json({ status: "done" }));
    await poll(pollRequest("account-a"), "shared-id");
    await poll(pollRequest("account-b"), "shared-id");
    expect(rows().map((row) => row.connectionId).sort()).toEqual(["account-a", "account-b"]);
    expect(new Set(rows().map((row) => row.usageEventId)).size).toBe(2);
    expect(rows().map((row) => JSON.parse(row.meta).nativeUnits)).toEqual([{}, {}]);
  });

  it.each(["failed", "cancelled", "expired"])("never records successful use for %s jobs", async (status) => {
    await submit();
    fetch.mockResolvedValueOnce(json({ status, video: { duration: 8 }, usage: { cost_usd: 2 } }));
    await poll(pollRequest(), "shared-id");
    fetch.mockResolvedValueOnce(json({ status: "done", video: { duration: 8 } }));
    await poll(pollRequest(), "shared-id");
    expect(rows()).toEqual([]);
  });
});
