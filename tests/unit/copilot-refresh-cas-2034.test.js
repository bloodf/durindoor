/**
 * Copilot background refresh compare-and-swap on the real connection store (#2034).
 *
 * The background scheduler refreshes a GitHub Copilot connection in two steps:
 * the GitHub OAuth refresh grant, then the Copilot session exchange. Each step
 * persists only while the stored row still matches the credentials, routing
 * metadata and revision that were sent. These cases interleave reconnects,
 * deletions, rotations and proxy changes with the real scheduler and real
 * SQLite writes. Some interleavings commit from a separate OS process writing
 * the same database file.
 *
 * Source: CLIProxyAPI a484af2460 lifecycle review (stale token saves must not
 * resurrect credentials or routing). Disposable DATA_DIR, synthetic tokens and
 * a fake network only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-copilot-cas-machine-id" }));

const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN = "https://api.github.com/copilot_internal/v2/token";
const FUTURE = () => Math.floor(Date.now() / 1000) + 1800;

const originalEnv = { DATA_DIR: process.env.DATA_DIR, HOME: process.env.HOME, DURINDOOR_DATABASE_ENGINE: process.env.DURINDOOR_DATABASE_ENGINE };
let tempDir;
let api;
let pools;
const calls = [];
/** Hooks run inside the matching fake response, after the request has left. */
let onGrant = null;
let onExchange = null;

async function fakeFetch(url, init = {}) {
  const target = String(url);
  const headers = new Headers(init.headers);
  const body = init.body == null ? "" : String(init.body);
  calls.push({ url: target, proxy: init.dispatcher?.proxyTag ?? null, authorization: headers.get("authorization"), body });
  if (target === GITHUB_TOKEN) {
    const sent = new URLSearchParams(body).get("refresh_token");
    await onGrant?.(sent);
    return Response.json({ access_token: `${sent}-access`, refresh_token: `${sent}-next`, expires_in: 28800 });
  }
  if (target === COPILOT_TOKEN) {
    const oauth = headers.get("authorization").replace(/^token /, "");
    await onExchange?.(oauth);
    return Response.json({ token: `${oauth}-session`, expires_at: FUTURE() });
  }
  throw new Error(`unexpected outbound request ${target}`);
}

/**
 * Another OS process writing the same database file. A separate process keeps
 * SQLite's file locking real; two SQLite libraries in one process would not.
 */
const OTHER_WRITER = `
const { DatabaseSync } = require("node:sqlite");
const [file, action, id, poolId] = process.argv.slice(1);
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 5000");
if (action === "delete") {
  if (db.prepare("DELETE FROM providerConnections WHERE id = ?").run(id).changes !== 1) process.exit(3);
} else {
  const row = db.prepare("SELECT data FROM providerConnections WHERE id = ?").get(id);
  if (!row) process.exit(3);
  const data = JSON.parse(row.data);
  data.providerSpecificData = { ...data.providerSpecificData, proxyPoolId: poolId };
  db.prepare("UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?").run(JSON.stringify(data), new Date(Date.now() + 1).toISOString(), id);
}
db.close();
`;
function otherProcess(...args) {
  const result = spawnSync(process.execPath, ["-e", OTHER_WRITER, api.dataFile(), ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });
  if (result.status !== 0) throw new Error(`other writer failed (${result.status}): ${result.stderr}`);
}
const otherProcessDelete = (id) => otherProcess("delete", id);
const otherProcessSetPool = (id, poolId) => otherProcess("pool", id, poolId);

async function seed(label, poolIndex = 0, extra = {}) {
  return api.createProviderConnection({
    provider: "github", authType: "oauth", name: label, email: `${label}@fixture.invalid`,
    accessToken: `${label}-oauth`, refreshToken: `${label}-refresh`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    testStatus: "active", isActive: true,
    providerSpecificData: { proxyPoolId: pools[poolIndex].id, copilotToken: `${label}-expired`, copilotTokenExpiresAt: 1 },
    ...extra
  });
}
const tick = () => api.background.runBackgroundTokenRefreshTick({ sleep: async () => {} });
const read = (id) => api.getProviderConnectionById(id);

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-copilot-cas-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  fs.mkdirSync(process.env.HOME, { recursive: true });
  // The adapter lives on a global that outlives modules; never reuse another file's store.
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.resetModules();
  const localDb = await import("@/lib/localDb");
  await (await import("@/lib/db/index.js")).initDb();
  const proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
  api = {
    ...localDb,
    dataFile: (await import("@/lib/db/paths.js")).currentDataFile,
    background: await import("../../src/sse/services/backgroundTokenRefresh.js"),
    dedup: await import("../../open-sse/services/tokenRefresh/dedup.js"),
    proxyFetch,
    restore: proxyFetch.__setOriginalFetchForTesting(fakeFetch)
  };
  pools = await Promise.all(["a", "b"].map((id) => createProxyPool({ name: `pool-${id}`, proxyUrl: `http://proxy-${id}.invalid:8080`, testStatus: "active" })));
}, 120_000);

afterAll(async () => {
  api?.restore?.();
  api?.proxyFetch?.__clearProxyDispatchersForTesting();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  for (const connection of await api.getProviderConnections()) await api.deleteProviderConnection(connection.id);
  api.dedup.__clearRefreshDedupCacheForTesting();
  calls.length = 0;
  onGrant = null;
  onExchange = null;
});

describe("Copilot background refresh on the real store", () => {
  it("commits both steps for two accounts, each through its own saved proxy route", async () => {
    const rows = [await seed("alpha", 0), await seed("beta", 1)];
    await tick();
    for (const [i, row] of rows.entries()) {
      const stored = await read(row.id);
      const label = ["alpha", "beta"][i];
      expect(stored.accessToken).toBe(`${label}-refresh-access`);
      expect(stored.refreshToken).toBe(`${label}-refresh-next`);
      expect(stored.providerSpecificData).toMatchObject({ proxyPoolId: pools[i].id, copilotToken: `${label}-refresh-access-session` });
    }
    const exchanges = calls.filter((call) => call.url === COPILOT_TOKEN).map((call) => call.authorization);
    expect(exchanges).toEqual(["token alpha-refresh-access", "token beta-refresh-access"]);
  });

  it.each([
    ["reconnect", async (row) => api.updateProviderConnection(row.id, {
      accessToken: "alpha-reconnected", refreshToken: "alpha-reconnected-refresh",
      providerSpecificData: { proxyPoolId: pools[1].id, copilotToken: "alpha-reconnected-session", copilotTokenExpiresAt: FUTURE() }
    })],
    ["rotation by another refresher", async (row) => api.updateProviderConnection(row.id, { refreshToken: "alpha-rotated-elsewhere", accessToken: "alpha-rotated-access" })],
    ["delete in another process", async (row) => otherProcessDelete(row.id)],
    ["proxy change in another process", async (row) => otherProcessSetPool(row.id, pools[1].id)]
  ])("refuses the OAuth grant result after a %s during the grant", async (change, write) => {
    const row = await seed("alpha");
    onGrant = async () => { onGrant = null; await write(row); };
    await tick();
    const stored = await read(row.id);
    expect(calls.filter((call) => call.url === COPILOT_TOKEN)).toEqual([]);
    if (change === "delete in another process") {
      expect(stored).toBeNull();
      expect(await api.getProviderConnections({ provider: "github" })).toEqual([]);
      return;
    }
    expect(stored.accessToken).not.toBe("alpha-refresh-access");
    expect(stored.refreshToken).not.toBe("alpha-refresh-next");
    if (change === "reconnect") {
      expect(stored).toMatchObject({ accessToken: "alpha-reconnected", refreshToken: "alpha-reconnected-refresh" });
      expect(stored.providerSpecificData).toMatchObject({ proxyPoolId: pools[1].id, copilotToken: "alpha-reconnected-session" });
    }
    if (change === "rotation by another refresher") expect(stored.refreshToken).toBe("alpha-rotated-elsewhere");
    if (change === "proxy change in another process") {
      expect(stored.providerSpecificData.proxyPoolId).toBe(pools[1].id);
      expect(stored.refreshToken).toBe("alpha-refresh");
    }
  });

  it.each([
    ["reconnect", async (row) => api.updateProviderConnection(row.id, {
      accessToken: "alpha-reconnected", refreshToken: "alpha-reconnected-refresh",
      providerSpecificData: { proxyPoolId: pools[1].id, copilotToken: "alpha-reconnected-session", copilotTokenExpiresAt: FUTURE() }
    })],
    ["delete in another process", async (row) => otherProcessDelete(row.id)],
    ["proxy change in another process", async (row) => otherProcessSetPool(row.id, pools[1].id)],
    ["rotation by another refresher", async (row) => api.updateProviderConnection(row.id, { refreshToken: "alpha-rotated-elsewhere" })]
  ])("refuses the session exchange result after a %s during the exchange", async (change, write) => {
    const row = await seed("alpha");
    onExchange = async () => { onExchange = null; await write(row); };
    await tick();
    const stored = await read(row.id);
    expect(calls.filter((call) => call.url === COPILOT_TOKEN)).toHaveLength(1);
    if (change === "delete in another process") {
      expect(stored).toBeNull();
      expect(await api.getProviderConnections({ provider: "github" })).toEqual([]);
      return;
    }
    expect(stored.providerSpecificData.copilotToken).not.toBe("alpha-refresh-access-session");
    if (change === "reconnect") {
      expect(stored.accessToken).toBe("alpha-reconnected");
      expect(stored.providerSpecificData).toEqual(expect.objectContaining({ proxyPoolId: pools[1].id, copilotToken: "alpha-reconnected-session" }));
    }
    if (change === "proxy change in another process") {
      expect(stored.providerSpecificData.proxyPoolId).toBe(pools[1].id);
      expect(stored.providerSpecificData.copilotToken).toBe("alpha-expired");
    }
    if (change === "rotation by another refresher") expect(stored.refreshToken).toBe("alpha-rotated-elsewhere");
  });

  it("does not resurrect a deleted account or restore its routing on the next tick", async () => {
    const row = await seed("alpha");
    onExchange = async () => { onExchange = null; await api.deleteProviderConnection(row.id); };
    await tick();
    await tick();
    expect(await read(row.id)).toBeNull();
    expect(calls.filter((call) => call.url === COPILOT_TOKEN)).toHaveLength(1);
  });

  it("keeps a stale refresh of one account away from the other account", async () => {
    const [alpha, beta] = [await seed("alpha", 0), await seed("beta", 1)];
    onGrant = async (sent) => {
      if (sent !== "alpha-refresh") return;
      await api.updateProviderConnection(alpha.id, { accessToken: "alpha-reconnected", refreshToken: "alpha-reconnected-refresh" });
    };
    await tick();
    const [a, b] = [await read(alpha.id), await read(beta.id)];
    expect(a).toMatchObject({ accessToken: "alpha-reconnected", refreshToken: "alpha-reconnected-refresh" });
    expect(b).toMatchObject({ accessToken: "beta-refresh-access", refreshToken: "beta-refresh-next" });
    expect(b.providerSpecificData).toMatchObject({ proxyPoolId: pools[1].id, copilotToken: "beta-refresh-access-session" });
    expect(JSON.stringify(b)).not.toContain("alpha");
  });
});
