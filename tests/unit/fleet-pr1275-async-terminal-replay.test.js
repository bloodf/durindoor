import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// SQLite composition only: registered routes, real auth/policy, raw provider
// parsers, owned jobs and strict ledger. No PostgreSQL acceptance is implied.
const transport = vi.hoisted(() => ({ fetch: vi.fn(), credentials: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => transport.fetch(...args) }));
// Registry imports must not start unrelated release-discovery HTTP or timers.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/fixture", updateKimchiUserAgent: async () => "kimchi/fixture",
}));
vi.mock("@/sse/services/auth.js", async (original) => ({
  ...await original(),
  getProviderCredentialsWithQuotaPreflight: (...args) => transport.credentials(...args),
  clearAccountError: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
}));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (id) => { const [provider, ...model] = id.split("/"); return { provider, model: model.join("/") }; },
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_provider, credentials) => credentials,
  updateProviderCredentials: async () => { throw new Error("Unexpected credential refresh"); },
}));

const cases = [
  { modality: "video", provider: "xai", model: "grok-imagine-video", seconds: 5 },
  { modality: "music", provider: "suno", model: "chirp-v4", seconds: 12.5 },
];
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
const epoch = "fixture-admission-epoch";
let adapter, database, video, musicPost, musicGet, directory, environment, listeners;
const json = (value) => Response.json(value);
const rows = () => adapter.all("SELECT * FROM usageHistory ORDER BY id");
const jobs = () => adapter.all("SELECT value FROM kv WHERE scope = 'mediaJobs'").map((row) => JSON.parse(row.value));
const receipts = () => adapter.all("SELECT * FROM kv WHERE scope = 'usageEventReceipts'");
const headers = (key = "caller-fixture", connection) => ({
  Authorization: `Bearer ${key}`, "Content-Type": "application/json",
  ...(connection ? { "x-9router-connection-id": connection } : {}),
});
const raw = (fixture, id, status, cost = 0.5, seconds = fixture.seconds) => ({
  ...(fixture.modality === "video"
    ? { request_id: id, status, video: { duration: seconds, url: "https://cdn.invalid/video" } }
    : { clips: [{ id, status, audio_url: "https://cdn.invalid/song.mp3", metadata: { duration: seconds } }] }),
  ...(cost === undefined ? {} : { usage: { cost_usd: cost, input_tokens: 3, output_tokens: 7, total_tokens: 10 } }),
});
const pending = (fixture) => fixture.modality === "video" ? "pending" : "streaming";
const complete = (fixture) => fixture.modality === "video" ? "done" : "complete";
const failed = (fixture) => fixture.modality === "video" ? "failed" : "error";

async function load() {
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  database = await import("@/lib/db/index.js");
  video = await import("@/app/api/v1/videos/[[...path]]/route.js");
  ({ POST: musicPost } = await import("@/app/api/v1/music/generations/route.js"));
  ({ GET: musicGet } = await import("@/app/api/v1/music/generations/[request_id]/route.js"));
}
async function reopen() {
  await adapter.close();
  // Keep module references aligned, including importOriginal auth's driver.
  global._dbAdapter.instance = null;
  global._dbAdapter.initPromise = null;
  global._apiKeyLimitState?.usage.clear();
  await load();
}
function submit(fixture) {
  const request = new Request(`http://localhost/v1/${fixture.modality === "video" ? "videos" : "music"}/generations`, {
    method: "POST", headers: headers(), body: JSON.stringify({ model: `${fixture.provider}/${fixture.model}`, prompt: "waves", duration: 99 }),
  });
  return fixture.modality === "video" ? video.POST(request, { params: Promise.resolve({ path: ["generations"] }) }) : musicPost(request);
}
function poll(fixture, id, key = "caller-fixture", connection = `account-${fixture.provider}`) {
  const request = new Request(`http://localhost/v1/${fixture.modality === "video" ? "videos" : "music/generations"}/${id}`, { headers: headers(key, connection) });
  return fixture.modality === "video" ? video.GET(request, { params: Promise.resolve({ path: [id] }) }) : musicGet(request, { params: Promise.resolve({ request_id: id }) });
}
function reply(fixture, id, status, cost = 0.5) {
  transport.fetch.mockResolvedValueOnce(json(raw(fixture, id, status, cost)));
}
function snapshot() {
  return {
    history: rows(), receipts: receipts(),
    daily: adapter.all("SELECT * FROM usageDaily"), lastSeen: adapter.all("SELECT * FROM usageLastSeen"),
    totals: adapter.all("SELECT * FROM apiKeyUsageTotals"),
    lifetime: adapter.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'"),
    jobs: adapter.all("SELECT * FROM kv WHERE scope = 'mediaJobs'"),
  };
}

beforeEach(async () => {
  listeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]));
  environment = Object.fromEntries(["HOME", "DATA_DIR", "DURINDOOR_DATABASE_ENGINE"].map((name) => [name, process.env[name]]));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "pr1275-async-replay-"));
  fs.mkdirSync(path.join(directory, "home"));
  process.env.HOME = path.join(directory, "home");
  process.env.DATA_DIR = path.join(directory, "data");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected external HTTP"); }));
  transport.fetch.mockReset().mockImplementation(async () => { throw new Error("Unexpected provider HTTP"); });
  transport.credentials.mockReset().mockImplementation(async (provider, _excluded, _model, options) => {
    expect(options.apiKeyId).toBe("caller-id");
    if (options.strictConnectionId) expect(options.strictConnectionId).toBe(`account-${provider}`);
    return { connectionId: `account-${provider}`, apiKey: "synthetic-provider-credential" };
  });
  await load(); // Existing driver bootstrap owns fresh SQLite initialization.
  expect(adapter.driver).toBe("better-sqlite3");
  expect(adapter.capabilities?.isPostgres).not.toBe(true);
  adapter.run("INSERT INTO kv(scope, key, value) VALUES('billing', 'epoch', ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", [JSON.stringify(epoch)]);
  for (const [id, key] of [["caller-id", "caller-fixture"], ["other-id", "other-fixture"]]) {
    adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, policy, createdAt) VALUES(?, ?, ?, 1, '[]', ?, ?)",
      [id, key, id, JSON.stringify({ monthlyBudget: 0.5 }), new Date().toISOString()]);
  }
  for (const fixture of cases) {
    adapter.run("INSERT INTO providerConnections(id, provider, name, authType, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, 'apikey', 1, '{}', ?, ?)",
      [`account-${fixture.provider}`, fixture.provider, "Synthetic account", new Date().toISOString(), new Date().toISOString()]);
  }
}, 60_000);
afterEach(async () => {
  expect(global.fetch).not.toHaveBeenCalled();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.unstubAllGlobals();
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal).has(listener)) process.removeListener(signal, listener);
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  // Retain disposable SQLite files under wrapper TMPDIR for independent review.
});

it.each(cases)("$modality: first terminal wins double poll, durable replay spends once and monthly admission denies", async (fixture) => {
  const id = `${fixture.modality}-paid`;
  reply(fixture, id, pending(fixture));
  const submitted = await submit(fixture);
  expect(submitted.status).toBe(200);
  expect(submitted.headers.get("x-9router-connection-id")).toBe(`account-${fixture.provider}`);
  expect(rows()).toEqual([]);
  const admission = jobs()[0];
  expect(admission).toMatchObject({ apiKeyId: "caller-id", billingEpoch: epoch, resourceId: id });
  const beforePoll = transport.fetch.mock.calls.length;
  expect((await poll(fixture, id, "other-fixture")).status).toBe(404);
  expect((await poll(fixture, id, "caller-fixture", "account-missing")).status).toBe(404);
  expect(transport.fetch).toHaveBeenCalledTimes(beforePoll);
  reply(fixture, id, pending(fixture));
  expect((await poll(fixture, id)).status).toBe(200);
  expect(rows()).toEqual([]);

  const releases = [];
  let bothReached;
  const reached = new Promise((resolve) => { bothReached = resolve; });
  transport.fetch.mockImplementation(() => new Promise((resolve) => {
    releases.push(resolve);
    if (releases.length === 2) bothReached();
  }));
  const first = poll(fixture, id);
  const second = poll(fixture, id);
  await reached; // Both handlers read pending ownership before either terminal.
  releases[0](json(raw(fixture, id, complete(fixture))));
  const firstResponse = await first;
  expect(firstResponse.status).toBe(200);
  const firstBody = await firstResponse.text();
  const winningJob = jobs()[0];
  releases[1](json(raw(fixture, id, complete(fixture), 0.75, 88)));
  const secondResponse = await second;
  expect(secondResponse.status).toBe(200);
  expect(await secondResponse.text()).toBe(firstBody);
  expect(jobs()[0]).toEqual(winningJob);
  expect(winningJob).toMatchObject({ ...admission, terminal: { status: "succeeded", cost: 0.5, costStatus: "known", costSource: "provider" } });
  expect(rows()).toHaveLength(1);
  const storedId = JSON.stringify(["billing", epoch, admission.usageEventId]);
  expect(rows()[0]).toMatchObject({ apiKey: "caller-fixture", provider: fixture.provider, model: fixture.model,
    connectionId: `account-${fixture.provider}`, endpoint: admission.endpoint, usageEventId: storedId,
    cost: 0.5, promptTokens: 3, completionTokens: 7, status: "ok" });
  expect(JSON.parse(rows()[0].meta)).toMatchObject({ modality: fixture.modality,
    nativeUnits: { [fixture.modality === "video" ? "videoSeconds" : "audioSeconds"]: fixture.seconds },
    costStatus: "known", costSource: "provider" });
  expect(receipts()).toEqual([{ scope: "usageEventReceipts", key: createHash("sha256").update(storedId).digest("hex"), value: "1" }]);
  expect(await database.getApiKeyUsageTotals("caller-id")).toMatchObject({ totalRequests: 1, totalTokens: 10, totalCost: 0.5, unknownCostRequests: 0 });
  expect(await database.getApiKeyUsageTotals("other-id")).toMatchObject({ totalRequests: 0, totalCost: 0 });
  const committed = snapshot();
  const calls = transport.fetch.mock.calls.length;
  transport.fetch.mockImplementation(async () => { throw new Error("Terminal replay must not dispatch"); });
  await reopen();
  expect((await submit(fixture)).status).toBe(429);
  const replay = await poll(fixture, id);
  expect(replay.status).toBe(200);
  expect(await replay.text()).toBe(firstBody);
  expect(snapshot()).toEqual(committed);
  expect(transport.fetch).toHaveBeenCalledTimes(calls);
  const [url, options] = transport.fetch.mock.calls[1];
  expect(options.method).toBe("GET");
  expect(String(url)).toContain(fixture.modality === "video" ? `/videos/${id}` : `/api/feed/v2?ids=${id}`);
});

it.each(cases)("$modality: pending and failed USD do not bill; missing USD stays unknown under policy B", async (fixture) => {
  const failureId = `${fixture.modality}-failed`;
  reply(fixture, failureId, pending(fixture));
  expect((await submit(fixture)).status).toBe(200);
  reply(fixture, failureId, pending(fixture));
  expect((await poll(fixture, failureId)).status).toBe(200);
  expect(rows()).toEqual([]);
  expect(receipts()).toEqual([]);
  reply(fixture, failureId, failed(fixture));
  expect((await poll(fixture, failureId)).status).toBe(200);
  const failedCalls = transport.fetch.mock.calls.length;
  expect((await poll(fixture, failureId)).status).toBe(200);
  expect(transport.fetch).toHaveBeenCalledTimes(failedCalls);
  expect(rows()).toEqual([]);
  expect(receipts()).toEqual([]);
  expect(await database.getApiKeyUsageTotals("caller-id")).toMatchObject({ totalRequests: 0, totalCost: 0 });

  const unknownId = `${fixture.modality}-unknown`;
  reply(fixture, unknownId, pending(fixture));
  expect((await submit(fixture)).status).toBe(200);
  const payload = raw(fixture, unknownId, complete(fixture));
  delete payload.usage;
  transport.fetch.mockResolvedValueOnce(json(payload));
  expect((await poll(fixture, unknownId)).status).toBe(200);
  expect(rows()).toHaveLength(1);
  expect(rows()[0].cost).toBeNull();
  expect(JSON.parse(rows()[0].meta)).toMatchObject({ costStatus: "unknown", costSource: "unavailable",
    nativeUnits: { [fixture.modality === "video" ? "videoSeconds" : "audioSeconds"]: fixture.seconds } });
  await reopen();
  expect((await poll(fixture, unknownId)).status).toBe(200);
  expect(await database.getApiKeyUsageTotals("caller-id")).toMatchObject({ totalRequests: 1, totalCost: 0, unknownCostRequests: 1 });
  reply(fixture, `${fixture.modality}-next`, pending(fixture));
  expect((await submit(fixture)).status).toBe(200);
  expect(rows()).toHaveLength(1);
  expect(receipts()).toHaveLength(1);
});

it.each(cases)("$modality: changed billing epoch rejects stale pending ownership before transport", async (fixture) => {
  const id = `${fixture.modality}-stale`;
  reply(fixture, id, pending(fixture));
  expect((await submit(fixture)).status).toBe(200);
  expect(jobs()[0].billingEpoch).toBe(epoch);
  adapter.run("UPDATE kv SET value = ? WHERE scope = 'billing' AND key = 'epoch'", [JSON.stringify("fixture-next-epoch")]);
  const calls = transport.fetch.mock.calls.length;
  expect((await poll(fixture, id)).status).toBe(404);
  expect(transport.fetch).toHaveBeenCalledTimes(calls);
  expect(rows()).toEqual([]);
  expect(receipts()).toEqual([]);
  expect(jobs()[0].terminal).toBeUndefined();
});
