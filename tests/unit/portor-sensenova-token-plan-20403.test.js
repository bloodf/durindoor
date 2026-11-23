import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  __setSensenovaDepsForTesting,
  getSensenovaUsage,
  parseSensenovaPoolUsage,
  PSD_ACCESS,
  PSD_ACCESS_EXPIRES,
  PSD_LEASE,
  PSD_REFRESH,
  SENSENOVA_POOL_USAGE_URL,
  SENSENOVA_TOKEN_URL
} from "../../open-sse/services/usage/sensenova.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

const NOW = 1_800_000_000_000;
const clock = { value: NOW };
const POOL = {
  plan: { id: "free", name: "Free Plan" },
  pools: [
    { name: "dedicated", pool_type: "dedicated", window_5h: { limit: "10", used: "10", reset_at: "1" } },
    {
      name: "general",
      pool_type: "default",
      window_5h: { limit: "120000", used: "30000", remaining: "90000", reset_at: "1800003600" },
      window_7d: { limit: "1200000", used: "0", remaining: "1200000", reset_at: "1800300000" }
    }
  ]
};

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// In-memory row store with the same compare-and-swap semantics as the repo function.
function memoryStore(psd) {
  const rows = new Map([["c1", { id: "c1", provider: "sensenova", providerSpecificData: { ...psd } }]]);
  return {
    rows,
    failWrites: false,
    async readConnection(id) {
      const row = rows.get(id);
      return row ? structuredClone(row) : null;
    },
    async swap(id, expected, next) {
      const row = rows.get(id);
      if (!row) return { applied: false, current: null };
      const isFinal = PSD_ACCESS in next;
      if (this.failWrites && isFinal) throw new Error("database is locked");
      const cur = row.providerSpecificData;
      if (Object.entries(expected).some(([k, v]) => (cur[k] ?? null) !== (v ?? null))) return { applied: false, current: structuredClone(row) };
      row.providerSpecificData = { ...cur, ...next };
      return { applied: true, current: structuredClone(row) };
    }
  };
}

// Fake SenseNova: each refresh token works exactly once (rotation), access tokens it minted pass pool reads.
function fakeSensenova({ tokenStatus = null, gate = null } = {}) {
  const valid = new Set(["rt-0"]);
  const access = new Set();
  const spent = [];
  let n = 0;
  const fetch = vi.fn(async (url, init) => {
    if (url === SENSENOVA_TOKEN_URL) {
      if (gate) await gate;
      const rt = new URLSearchParams(init.body).get("refresh_token");
      spent.push(rt);
      if (tokenStatus) return json(tokenStatus, {});
      if (!valid.delete(rt)) return json(401, { error: "invalid_grant" });
      n += 1;
      valid.add(`rt-${n}`);
      access.add(`at-${n}`);
      return json(200, { access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_in: 10800 });
    }
    if (url === SENSENOVA_POOL_USAGE_URL) {
      const bearer = init.headers.Authorization.replace("Bearer ", "");
      return access.has(bearer) ? json(200, POOL) : json(401, {});
    }
    throw new Error(`unexpected url ${url}`);
  });
  return { fetch, spent, valid };
}

function setup(psd, fakeOpts) {
  const store = memoryStore(psd);
  const fake = fakeSensenova(fakeOpts);
  __setSensenovaDepsForTesting({ fetch: fake.fetch, now: () => clock.value, readConnection: (id) => store.readConnection(id), swap: (...a) => store.swap(...a) });
  return { store, fake, conn: () => store.rows.get("c1") };
}

afterEach(() => {
  __setSensenovaDepsForTesting(null);
  clock.value = NOW;
});

describe("SenseNova Token Plan balance parsing (OmniRoute #20403)", () => {
  it("reads both windows of the default pool and ignores dedicated pools", () => {
    const usage = parseSensenovaPoolUsage(POOL);
    expect(usage.plan).toBe("Free Plan");
    expect(usage.quotas["5h"]).toMatchObject({ used: 30000, total: 120000, remaining: 90000, remainingPercentage: 75, unlimited: false });
    expect(usage.quotas["5h"].resetAt).toBe(new Date(1800003600 * 1000).toISOString());
    expect(usage.quotas["7d"]).toMatchObject({ used: 0, total: 1200000, remainingPercentage: 100 });
    expect(usage.limitReached).toBeUndefined();
  });

  it("derives a limit from used+remaining, flags exhaustion, and rejects junk", () => {
    const usage = parseSensenovaPoolUsage({ pools: [{ window_5h: { used: "5", remaining: "0", reset_at: "junk" } }] });
    expect(usage.quotas["5h"]).toMatchObject({ used: 5, total: 5, resetAt: null });
    expect(usage.limitReached).toBe(true);
    expect(parseSensenovaPoolUsage(null)).toBeNull();
    expect(parseSensenovaPoolUsage({ pools: [{ pool_type: "dedicated", window_5h: {} }] })).toBeNull();
  });

  it("is wired into the usage dispatcher and explains a missing console token", async () => {
    const result = await getUsageForProvider({ id: "c1", provider: "sensenova", authType: "apikey", apiKey: "sk-x", providerSpecificData: {} });
    expect(result.message).toMatch(/refresh token/);
  });
});

describe("SenseNova console session rotation", () => {
  it("persists the rotated refresh token via compare-and-swap before using it", async () => {
    const { store, fake, conn } = setup({ [PSD_REFRESH]: "rt-0" });
    const order = [];
    const origSwap = store.swap.bind(store);
    store.swap = async (...a) => {
      if (PSD_ACCESS in a[2]) order.push("persist");
      return origSwap(...a);
    };
    const impl = fake.fetch.getMockImplementation();
    fake.fetch.mockImplementation(async (url, init) => {
      if (url === SENSENOVA_POOL_USAGE_URL) order.push("use");
      return impl(url, init);
    });

    const usage = await getSensenovaUsage(conn());
    expect(usage.quotas["5h"].used).toBe(30000);
    expect(order).toEqual(["persist", "use"]);
    const psd = store.rows.get("c1").providerSpecificData;
    expect(psd[PSD_REFRESH]).toBe("rt-1");
    expect(psd[PSD_ACCESS]).toBe("at-1");
    expect(psd[PSD_ACCESS_EXPIRES]).toBe(NOW + 10800 * 1000);
    expect(psd[PSD_LEASE]).toBeNull();
  });

  it("reuses a live stored access token without spending the refresh token", async () => {
    const { fake, conn } = setup({ [PSD_REFRESH]: "rt-0", [PSD_ACCESS]: "at-9", [PSD_ACCESS_EXPIRES]: NOW + 3_600_000 });
    fake.fetch.mockImplementation(async (url) => (url === SENSENOVA_POOL_USAGE_URL ? json(200, POOL) : json(500, {})));
    const usage = await getSensenovaUsage(conn());
    expect(usage.plan).toBe("Free Plan");
    expect(fake.spent).toEqual([]);
  });

  it("concurrent refreshes in one process spend the token once", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { store, fake, conn } = setup({ [PSD_REFRESH]: "rt-0" }, { gate });
    const runs = [getSensenovaUsage(conn()), getSensenovaUsage(conn()), getSensenovaUsage(conn())];
    release();
    const results = await Promise.all(runs);
    for (const r of results) expect(r.quotas["5h"].used).toBe(30000);
    expect(fake.spent).toEqual(["rt-0"]);
    expect(store.rows.get("c1").providerSpecificData[PSD_REFRESH]).toBe("rt-1");
  });

  it("a second process sees the lease and does not spend the same token", async () => {
    const { store, fake, conn } = setup({ [PSD_REFRESH]: "rt-0", [PSD_LEASE]: `other:${NOW + 10_000}` });
    const usage = await getSensenovaUsage(conn());
    expect(usage.message).toMatch(/in progress/);
    expect(fake.spent).toEqual([]);
    expect(store.rows.get("c1").providerSpecificData[PSD_REFRESH]).toBe("rt-0");
  });

  it("keeps the last good token when the exchange fails", async () => {
    const { store, fake, conn } = setup({ [PSD_REFRESH]: "rt-0", [PSD_ACCESS]: "at-old", [PSD_ACCESS_EXPIRES]: NOW + 60_000 }, { tokenStatus: 503 });
    const impl = fake.fetch.getMockImplementation();
    fake.fetch.mockImplementation(async (url, init) => (url === SENSENOVA_POOL_USAGE_URL ? json(200, POOL) : impl(url, init)));
    const usage = await getSensenovaUsage(conn());
    // Access token is inside the refresh margin but still valid: it is used as fallback.
    expect(usage.plan).toBe("Free Plan");
    const psd = store.rows.get("c1").providerSpecificData;
    expect(psd[PSD_REFRESH]).toBe("rt-0");
    expect(psd[PSD_ACCESS]).toBe("at-old");
    expect(psd[PSD_LEASE]).toBeNull();
  });

  it("reports a rejected credential without clearing it", async () => {
    const { store, conn } = setup({ [PSD_REFRESH]: "rt-0" }, { tokenStatus: 401 });
    const usage = await getSensenovaUsage(conn());
    expect(usage.message).toMatch(/rejected/);
    expect(store.rows.get("c1").providerSpecificData[PSD_REFRESH]).toBe("rt-0");
  });

  it("keeps a rotation in memory when the write fails and never replays the consumed token", async () => {
    const { store, fake, conn } = setup({ [PSD_REFRESH]: "rt-0" });
    store.failWrites = true;
    expect((await getSensenovaUsage(conn())).quotas["5h"].used).toBe(30000);
    // The row still names the consumed token; the rotation lives in memory.
    expect(store.rows.get("c1").providerSpecificData[PSD_REFRESH]).toBe("rt-0");

    // The memory session is reused while live.
    expect((await getSensenovaUsage(conn())).quotas).toBeDefined();
    expect(fake.spent).toEqual(["rt-0"]);

    // After it expires, the next refresh spends rt-1 (not dead rt-0) and persists the rotation.
    store.failWrites = false;
    clock.value = NOW + 4 * 3_600_000;
    expect((await getSensenovaUsage(conn())).quotas).toBeDefined();
    expect(fake.spent).toEqual(["rt-0", "rt-1"]);
    expect(store.rows.get("c1").providerSpecificData).toMatchObject({ [PSD_REFRESH]: "rt-2", [PSD_ACCESS]: "at-2" });
  });

  it("drops the result when the credential was replaced mid-exchange", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { store, conn } = setup({ [PSD_REFRESH]: "rt-0" }, { gate });
    const run = getSensenovaUsage(conn());
    await vi.waitFor(() => expect(store.rows.get("c1").providerSpecificData[PSD_LEASE]).toBeTruthy());
    // Operator pastes a new credential while the exchange is in flight.
    store.rows.get("c1").providerSpecificData = { [PSD_REFRESH]: "operator-token" };
    release();
    const usage = await run;
    expect(usage.message).toMatch(/changed/);
    expect(store.rows.get("c1").providerSpecificData[PSD_REFRESH]).toBe("operator-token");
  });
});

describe("compareAndSwapProviderSpecificData (real sqlite)", () => {
  let directory;
  let db;
  let adapter;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-sensenova-cas-"));
    vi.stubEnv("DATA_DIR", directory);
    vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
    db = await import("@/lib/localDb");
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  }, 30_000);

  afterAll(async () => {
    await adapter?.close?.();
    vi.unstubAllEnvs();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it("writes only when the stored token still matches and keeps other fields", async () => {
    const conn = await db.createProviderConnection({
      provider: "sensenova", authType: "apikey", name: "sn", apiKey: "sk-test",
      providerSpecificData: { [PSD_REFRESH]: "rt-0", label: "keep" }
    });
    const first = await db.compareAndSwapProviderSpecificData(conn.id, { [PSD_REFRESH]: "rt-0" }, { [PSD_REFRESH]: "rt-1" });
    expect(first.applied).toBe(true);
    // A second writer holding the same consumed token loses.
    const second = await db.compareAndSwapProviderSpecificData(conn.id, { [PSD_REFRESH]: "rt-0" }, { [PSD_REFRESH]: "rt-x" });
    expect(second.applied).toBe(false);
    const stored = await db.getProviderConnectionById(conn.id);
    expect(stored.providerSpecificData).toMatchObject({ [PSD_REFRESH]: "rt-1", label: "keep" });
    expect(stored.apiKey).toBe("sk-test");
    expect((await db.compareAndSwapProviderSpecificData("missing", {}, {})).applied).toBe(false);
  });
});
