import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createOwnerAwareHandler } = require("../../custom-server.js");
const WRAPPER_PEER_TOKEN = "connection-groups-wrapper-peer";
const originalPeerToken = process.env.NINEROUTER_PEER_TOKEN;

/** Real API + temporary SQLite tests for issue #747. */
let tempDir;
let originalDataDir;
let collectionRoute;
let itemRoute;
let membersRoute;

function request(url, method, body) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-connection-groups-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  collectionRoute = await import("../../src/app/api/connection-groups/route.js");
  itemRoute = await import("../../src/app/api/connection-groups/[id]/route.js");
  membersRoute = await import("../../src/app/api/connection-groups/[id]/members/route.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = "2026-09-04T00:00:00.000Z";
  for (const [id, name] of [["connection-one", "Paid account"], ["connection-two", "Backup account"]]) {
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, "openai", "api_key", name, "{}", now, now]
    );
  }
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalPeerToken === undefined) delete process.env.NINEROUTER_PEER_TOKEN;
  else process.env.NINEROUTER_PEER_TOKEN = originalPeerToken;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("connection groups API", () => {
  it("creates, lists, replaces membership, and deletes without orphaning connections", async () => {
    const create = await collectionRoute.POST(request("http://localhost/api/connection-groups", "POST", {
      name: "Production",
      description: "Paid accounts",
      connectionIds: ["connection-one"],
    }));
    expect(create.status).toBe(201);
    const group = await create.json();
    expect(group.connectionIds).toEqual(["connection-one"]);

    const replace = await itemRoute.PUT(request(`http://localhost/api/connection-groups/${group.id}`, "PUT", {
      connectionIds: ["connection-two"],
    }), params(group.id));
    expect(replace.status).toBe(200);
    expect((await replace.json()).connectionIds).toEqual(["connection-two"]);

    const listed = await collectionRoute.GET();
    expect((await listed.json()).groups).toEqual([
      expect.objectContaining({ id: group.id, connectionIds: ["connection-two"] }),
    ]);

    expect((await itemRoute.DELETE(undefined, params(group.id))).status).toBe(204);
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.get(`SELECT id FROM providerConnections WHERE id = ?`, ["connection-two"])).toEqual({ id: "connection-two" });
    expect(db.all(`SELECT * FROM connectionGroupMembers WHERE groupId = ?`, [group.id])).toEqual([]);
  });

  it("rejects removing a missing membership without changing the group", async () => {
    const create = await collectionRoute.POST(request("http://localhost/api/connection-groups", "POST", {
      name: "Production",
      connectionIds: ["connection-one"],
    }));
    const group = await create.json();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const originalUpdatedAt = "2026-09-04T00:00:00.000Z";
    db.run(`UPDATE connectionGroups SET updatedAt = ? WHERE id = ?`, [originalUpdatedAt, group.id]);

    const remove = await membersRoute.DELETE(request(
      `http://localhost/api/connection-groups/${group.id}/members`,
      "DELETE",
      { connectionId: "connection-two" },
    ), params(group.id));

    expect(remove.status).toBe(400);
    expect(await remove.json()).toEqual(expect.objectContaining({ code: "unknown_membership" }));
    expect(db.get(`SELECT updatedAt FROM connectionGroups WHERE id = ?`, [group.id])).toEqual({
      updatedAt: originalUpdatedAt,
    });
    expect(db.all(
      `SELECT connectionId FROM connectionGroupMembers WHERE groupId = ? ORDER BY connectionId`,
      [group.id],
    )).toEqual([{ connectionId: "connection-one" }]);
  });

  it("rejects unknown refs, duplicate group names, duplicate members, and oversized membership", async () => {
    const create = await collectionRoute.POST(request("http://localhost/api/connection-groups", "POST", {
      name: "Production", connectionIds: ["connection-one"],
    }));
    const group = await create.json();

    const duplicateName = await collectionRoute.POST(request("http://localhost/api/connection-groups", "POST", { name: "production" }));
    expect(duplicateName.status).toBe(400);
    expect((await duplicateName.json()).code).toBe("duplicate_name");

    const unknown = await itemRoute.PUT(request(`http://localhost/api/connection-groups/${group.id}`, "PUT", {
      connectionIds: ["missing-connection"],
    }), params(group.id));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).code).toBe("unknown_id");

    const duplicateMember = await membersRoute.POST(request(`http://localhost/api/connection-groups/${group.id}/members`, "POST", {
      connectionId: "connection-one",
    }), params(group.id));
    expect(duplicateMember.status).toBe(400);
    expect((await duplicateMember.json()).code).toBe("duplicate_membership");

    const oversized = await itemRoute.PUT(request(`http://localhost/api/connection-groups/${group.id}`, "PUT", {
      connectionIds: Array.from({ length: 501 }, (_, i) => `connection-${i}`),
    }), params(group.id));
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).code).toBe("too_many_ids");
  });

  it("bounds malformed and oversized request bodies before persistence", async () => {
    const malformed = await collectionRoute.POST(new Request("http://localhost/api/connection-groups", {
      method: "POST", headers: { "content-type": "application/json" }, body: "not-json",
    }));
    expect(malformed.status).toBe(400);

    const oversized = await collectionRoute.POST(new Request("http://localhost/api/connection-groups", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "A", description: "x".repeat(70_000) }),
    }));
    expect(oversized.status).toBe(400);
  });
});

/**
 * Auth regression — exercises the real `proxy` function with temp-DB
 * settings and the production custom-server request wrapper. This proves the
 * management prefix rejects a wrapper-stamped remote peer, preserves the
 * loopback open-dashboard policy only for wrapper-stamped loopback traffic,
 * and accepts the machine-bound CLI token. The guard itself is never mocked.
 */
describe("dashboard-guard coverage of /api/connection-groups", () => {
  let proxy;
  let machineId;
  beforeEach(async () => {
    const id = await import("@/shared/utils/machineId");
    machineId = id.getConsistentMachineId;
    vi.spyOn(id, "getConsistentMachineId").mockImplementation(async (salt) =>
      salt === "9r-cli-auth" ? "machine-cli" : await machineId(salt)
    );
    ({ proxy } = await import("../../src/dashboardGuard.js"));
    // Persist requireLogin=false so the loopback open-dashboard branch
    // is exercised with real settings (no localStorage mocking).
    const { updateSettings } = await import("../../src/lib/db/index.js");
    await updateSettings({ requireLogin: false });
  });

  function guardReq(pathname, headers = {}, cookies = {}) {
    return {
      nextUrl: {
        pathname,
        searchParams: new URL(`http://localhost${pathname}`).searchParams,
      },
      headers: new Headers(headers),
      method: "GET",
      cookies: { get: vi.fn((name) => cookies[name]) },
      url: `http://localhost${pathname}`,
    };
  }

  async function wrapperStampedHeaders(pathname, remoteAddress, host) {
    return new Promise((resolve) => {
      const wrapped = createOwnerAwareHandler(
        (request) => resolve(new Headers(request.headers)),
        {
          secret: "a".repeat(64),
          peerToken: WRAPPER_PEER_TOKEN,
          verifyPeerOwner: vi.fn(async () => false),
        },
      );
      wrapped(
        {
          method: "GET",
          url: pathname,
          headers: { host },
          socket: { remoteAddress, remotePort: 45000 },
        },
        { setHeader: vi.fn() },
      );
    });
  }

  for (const path of ["/api/connection-groups", "/api/connection-groups/g1"]) {
    it(`rejects wrapper-stamped remote unauthenticated ${path}`, async () => {
      const headers = await wrapperStampedHeaders(path, "203.0.113.10", "router.example.com");
      const res = await proxy(guardReq(path, headers));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it(`allows machine-bound CLI token to ${path}`, async () => {
      const res = await proxy(guardReq(path, {
        host: "router.example.com",
        "x-9r-cli-token": "machine-cli",
      }));
      expect(res.status).not.toBe(401);
    });

    it(`preserves wrapper-stamped loopback open-dashboard access to ${path}`, async () => {
      const headers = await wrapperStampedHeaders(path, "127.0.0.1", "localhost:20128");
      expect(headers.get("x-9r-real-ip")).toBe("127.0.0.1");
      expect(headers.get("x-9r-peer-token")).toBe(WRAPPER_PEER_TOKEN);
      const res = await proxy(guardReq(path, headers));
      expect(res.status).not.toBe(401);
    });
  }
});
