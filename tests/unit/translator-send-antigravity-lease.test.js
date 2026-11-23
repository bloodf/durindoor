import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ execute: vi.fn(), refresh: vi.fn(), detailed: vi.fn() }));
vi.mock("open-sse/index.js", () => ({ getExecutor: () => ({ execute: mock.execute, refreshCredentials: mock.refresh }) }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ refreshCredentials: mock.refresh, refreshCredentialsDetailed: mock.detailed }) }));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: async () => ({}) }));

let dir, oldDataDir, db, POST;
const id = "translator-fixture";
const original = { accessToken: "old-access", refreshToken: "old-refresh", providerSpecificData: {} };

async function send(provider = "antigravity") {
  return POST(new Request("http://localhost/api/translator/send", {
    method: "POST", body: JSON.stringify({ provider, model: "fixture", body: { messages: [] } }),
  }));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "translator-lease-"));
  oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.clearAllMocks();
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  db = await getAdapter();
  const now = new Date().toISOString();
  db.run(`INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
    VALUES (?, 'antigravity', 'oauth', 'fixture', 1, 1, ?, ?, ?)`, [id, JSON.stringify(original), now, now]);
  ({ POST } = await import("../../src/app/api/translator/send/route.js"));
  mock.execute.mockImplementation(async ({ credentials }) => ({ response: new Response("fixture", { status: credentials.accessToken === "old-access" ? 401 : 200 }) }));
  mock.detailed.mockResolvedValue({ ok: true, tokens: { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 } });
}, 30_000);

afterEach(() => {
  global._dbAdapter?.close?.();
  delete global._dbAdapter;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("translator send stored Antigravity refresh", () => {
  it("commits under the lease before retrying with refreshed credentials", async () => {
    mock.detailed.mockImplementation(async () => {
      expect(db.get("SELECT attemptState FROM antigravityRefreshLeases WHERE connectionId = ?", [id]).attemptState).toBe("dispatched");
      return { ok: true, tokens: { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 } };
    });
    expect((await send()).status).toBe(200);
    expect(mock.detailed).toHaveBeenCalledOnce();
    expect(mock.refresh).not.toHaveBeenCalled();
    expect(mock.execute).toHaveBeenCalledTimes(2);
    const { getProviderConnectionById } = await import("../../src/lib/localDb.js");
    expect(await getProviderConnectionById(id)).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
  });

  it("does not retry a newer caller with an older joined refresh result", async () => {
    let started;
    let finish;
    const dispatched = new Promise((resolve) => { started = resolve; });
    const release = new Promise((resolve) => { finish = resolve; });
    mock.execute.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    mock.detailed.mockImplementation(async () => {
      started();
      await release;
      return { ok: true, tokens: { accessToken: "stale", refreshToken: "stale-refresh" } };
    });
    const first = send();
    await dispatched;
    db.run("UPDATE providerConnections SET data = ? WHERE id = ?", [JSON.stringify({ ...original, accessToken: "replacement", refreshToken: "replacement-refresh" }), id]);
    const second = send();
    await vi.waitFor(() => expect(mock.execute).toHaveBeenCalledTimes(2));
    finish();
    expect((await first).status).toBe(401);
    expect((await second).status).toBe(401);
    expect(mock.execute).toHaveBeenCalledTimes(2);
    expect(mock.detailed).toHaveBeenCalledOnce();
  });

  it.each([false, true])("blocks a competing %s dispatched lease", async (uncertain) => {
    const { acquireAntigravityLease, markAntigravityDispatched } = await import("../../src/lib/antigravity/leaseSql.js");
    const claim = acquireAntigravityLease(db, { connectionId: id, refreshToken: original.refreshToken, owner: "competitor" });
    expect(claim.ok).toBe(true);
    expect(markAntigravityDispatched(db, claim.lease)).toBe(true);
    if (uncertain) db.run("UPDATE antigravityRefreshLeases SET leaseExpiresAt = 1 WHERE connectionId = ?", [id]);
    expect((await send()).status).toBe(401);
    expect(mock.detailed).not.toHaveBeenCalled();
    expect(mock.execute).toHaveBeenCalledOnce();
    expect(JSON.parse(db.get("SELECT data FROM providerConnections WHERE id = ?", [id]).data)).toMatchObject(original);
  });

  it("does not overwrite a concurrent credential change or retry a rejected commit", async () => {
    mock.detailed.mockImplementation(async () => {
      db.run("UPDATE providerConnections SET data = ? WHERE id = ?", [JSON.stringify({ ...original, accessToken: "replacement", refreshToken: "replacement-refresh" }), id]);
      return { ok: true, tokens: { accessToken: "stale", refreshToken: "stale-refresh" } };
    });
    expect((await send()).status).toBe(401);
    expect(mock.execute).toHaveBeenCalledOnce();
    expect(JSON.parse(db.get("SELECT data FROM providerConnections WHERE id = ?", [id]).data)).toMatchObject({ accessToken: "replacement", refreshToken: "replacement-refresh" });
  });

  it("preserves the direct refresh and update path for another provider", async () => {
    db.run("UPDATE providerConnections SET provider = 'openai' WHERE id = ?", [id]);
    mock.refresh.mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect((await send("openai")).status).toBe(200);
    expect(mock.refresh).toHaveBeenCalledOnce();
    expect(mock.detailed).not.toHaveBeenCalled();
    const { getProviderConnectionById } = await import("../../src/lib/localDb.js");
    expect(await getProviderConnectionById(id)).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
  });
});
