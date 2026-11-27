import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  __setSensenovaDepsForTesting, getSensenovaUsage,
  PSD_ACCESS, PSD_ACCESS_EXPIRES, PSD_LEASE, PSD_REFRESH,
  SENSENOVA_POOL_USAGE_URL, SENSENOVA_TOKEN_URL
} from "../../open-sse/services/usage/sensenova.js";

const NOW = 1_800_000_000_000;
const POOL = { pools: [{ pool_type: "default", window_5h: { limit: 10, used: 2 } }] };
const json = (status, body = {}) => new Response(JSON.stringify(body), { status });
let db, adapter, directory;

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "sensenova-boundaries-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  db = await import("@/lib/localDb");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
}, 30_000);

afterEach(() => {
  __setSensenovaDepsForTesting(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(async () => {
  await adapter?.close?.();
  vi.unstubAllEnvs();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

async function account(extra = {}) {
  return db.createProviderConnection({
    provider: "sensenova", authType: "apikey", name: `fixture-${Math.random()}`, apiKey: "offline-key",
    providerSpecificData: { [PSD_REFRESH]: "selected-refresh", marker: "preserve", ...extra }
  });
}
const stored = async (conn) => (await db.getProviderConnectionById(conn.id)).providerSpecificData;
function transport(fn) {
  const fetch = vi.fn(fn);
  // Only the endpoint and clock are mocked: session reads, leases and CAS use sqlite.
  __setSensenovaDepsForTesting({ fetch, now: () => NOW });
  return fetch;
}

describe("SenseNova endpoint/session boundaries with real persistence", () => {
  it.each([
    [400, { error: "invalid_grant" }, true],
    [400, { error: "invalid_client" }, false],
    [400, { error: "invalid_request" }, false],
    [401, {}, true], [403, {}, false], [404, {}, false], [409, {}, false],
    [408, {}, false], [429, {}, false], [503, {}, false]
  ])("preserves stored credentials after exchange %s (%j)", async (status, body, auth) => {
    const conn = await account();
    const fetch = transport(async () => json(status, body));
    const result = await getSensenovaUsage(conn);
    expect(result.message).toMatch(auth ? /rejected/ : /unreachable/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await stored(conn)).toMatchObject({ [PSD_REFRESH]: "selected-refresh", marker: "preserve", [PSD_LEASE]: null });
    expect((await stored(conn))[PSD_ACCESS]).toBeUndefined();
  });

  it.each([400, 403, 404, 408, 429, 500])("pool %s never spends a refresh token", async (status) => {
    const conn = await account({ [PSD_ACCESS]: "stored-access", [PSD_ACCESS_EXPIRES]: NOW + 3_600_000 });
    const before = await stored(conn);
    const fetch = transport(async (url) => {
      expect(url).toBe(SENSENOVA_POOL_USAGE_URL);
      return json(status);
    });
    const result = await getSensenovaUsage(conn);
    expect(result.message).toMatch(status === 403 ? /does not allow/ : /unreachable/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await stored(conn)).toEqual(before);
  });

  it.each(["network", "malformed-json", "missing-access"])("preserves refresh credentials after %s exchange failure", async (failure) => {
    const conn = await account();
    const fetch = transport(async () => {
      if (failure === "network") throw new TypeError("offline transport failure");
      if (failure === "malformed-json") return new Response("{", { status: 200 });
      return json(200, { refresh_token: "must-not-persist" });
    });
    expect((await getSensenovaUsage(conn)).message).toMatch(/unreachable/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await stored(conn)).toMatchObject({ [PSD_REFRESH]: "selected-refresh", [PSD_LEASE]: null });
    expect((await stored(conn))[PSD_ACCESS]).toBeUndefined();
  });

  it("retains an unexpired fallback on permission failure without another exchange for pool 403", async () => {
    const conn = await account({ [PSD_ACCESS]: "expiring-access", [PSD_ACCESS_EXPIRES]: NOW + 60_000 });
    const fetch = transport(async (url, init) => {
      if (url === SENSENOVA_TOKEN_URL) return json(403);
      expect(url).toBe(SENSENOVA_POOL_USAGE_URL);
      expect(init.headers.Authorization).toBe("Bearer expiring-access");
      return json(403);
    });
    expect((await getSensenovaUsage(conn)).message).toMatch(/does not allow/);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await stored(conn)).toMatchObject({ [PSD_REFRESH]: "selected-refresh", [PSD_ACCESS]: "expiring-access", [PSD_LEASE]: null });
  });

  it("bounds repeated pool 401 to one exchange and two reads, using only the selected account/proxy", async () => {
    const conn = await account({ [PSD_ACCESS]: "rejected-access", [PSD_ACCESS_EXPIRES]: NOW + 3_600_000 });
    const other = await account({ [PSD_REFRESH]: "other-refresh" });
    const otherBefore = await stored(other);
    const proxy = { proxyUrl: "http://offline.invalid:8080", strictProxy: true };
    const calls = [];
    const fetch = transport(async (url, init, selectedProxy) => {
      expect(selectedProxy).toBe(proxy);
      calls.push(url);
      if (url === SENSENOVA_TOKEN_URL) {
        expect(new URLSearchParams(init.body).get("refresh_token")).toBe("selected-refresh");
        return json(200, { access_token: "new-access", refresh_token: "rotated", expires_in: 10800 });
      }
      expect(url).toBe(SENSENOVA_POOL_USAGE_URL);
      if (init.headers.Authorization === "Bearer new-access") {
        expect((await stored(conn))[PSD_REFRESH]).toBe("rotated");
      }
      return json(401);
    });
    expect((await getSensenovaUsage(conn, proxy)).message).toMatch(/rejected/);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([SENSENOVA_POOL_USAGE_URL, SENSENOVA_TOKEN_URL, SENSENOVA_POOL_USAGE_URL]);
    expect(await stored(other)).toEqual(otherBefore);
  });

  it.each([SENSENOVA_TOKEN_URL, SENSENOVA_POOL_USAGE_URL])("refuses hostile redirects from %s", async (endpoint) => {
    const conn = await account(endpoint === SENSENOVA_POOL_USAGE_URL
      ? { [PSD_ACCESS]: "stored-access", [PSD_ACCESS_EXPIRES]: NOW + 3_600_000 }
      : {});
    const fetch = transport(async (url, init) => {
      expect(url).toBe(endpoint);
      // Model fetch's redirect:error contract for a 307 that would forward the POST body.
      if (init.redirect !== "error") throw new Error("fixture detected credential forwarding");
      expect(init.redirect).toBe("error");
      return new Response(null, { status: 307, headers: { Location: "https://attacker.invalid/steal" } });
    });
    const result = await getSensenovaUsage(conn);
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
    expect(result.message).toMatch(/unreachable/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await stored(conn))[PSD_REFRESH]).toBe("selected-refresh");
  });

  it("never derives credential destinations from hostile connection URLs", async () => {
    const conn = await account({ baseUrl: "https://token.sensenova.cn.attacker.invalid/v1", tokenUrl: "http://127.0.0.1/steal" });
    const fetch = transport(async (url, init) => {
      expect(init.redirect).toBe("error");
      if (url === SENSENOVA_TOKEN_URL) {
        expect(init.noTransportReplay).toBe(true);
        return json(200, { access_token: "new-access", refresh_token: "rotated" });
      }
      expect(url).toBe(SENSENOVA_POOL_USAGE_URL);
      return json(200, POOL);
    });
    expect((await getSensenovaUsage(conn)).quotas["5h"].used).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([SENSENOVA_TOKEN_URL, SENSENOVA_POOL_USAGE_URL])("aborts a stalled %s at its 10s deadline", async (endpoint) => {
    const conn = await account(endpoint === SENSENOVA_POOL_USAGE_URL
      ? { [PSD_ACCESS]: "stored-access", [PSD_ACCESS_EXPIRES]: NOW + 3_600_000 }
      : {});
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
      return controller.signal;
    });
    const fetch = transport((url, init) => {
      expect(url).toBe(endpoint);
      return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    });
    const run = getSensenovaUsage(conn);
    // DB work uses real IO; wait until the endpoint has actually started.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(timeout).toHaveBeenCalledWith(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await run).message).toMatch(/unreachable/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await stored(conn))[PSD_REFRESH]).toBe("selected-refresh");
  });
});
