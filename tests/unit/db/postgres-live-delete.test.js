// Delete paths against a real PostgreSQL cluster.
//
// Opt-in: set DURINDOOR_TEST_PG_URL to a superuser URL of a throwaway cluster,
// e.g. postgres://postgres:dd@127.0.0.1:55432/postgres. The suite creates and
// drops its own database, so it never touches data it did not create. With the
// variable unset, or the cluster unreachable, the suite is skipped.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ADMIN_URL = process.env.DURINDOOR_TEST_PG_URL;

async function reachable(url) {
  if (!url) return false;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const PG_UP = await reachable(ADMIN_URL);
const DB_NAME = `dd_delete_${process.pid}_${Date.now()}`;

async function admin(sql) {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

describe.skipIf(!PG_UP)("PostgreSQL delete paths (live cluster)", () => {
  let adapter;
  let db;

  beforeAll(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dd-pg-delete-"));
    await admin(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${DB_NAME}`;
    const { createPostgresAdapter } = await import("@/lib/db/adapters/pgAdapter.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const { setActiveAdapter } = await import("@/lib/db/driver.js");
    adapter = await createPostgresAdapter({ url: url.toString() });
    await runMigrationOnce(adapter);
    setActiveAdapter(adapter);
    db = await import("@/lib/db/index.js");
  }, 60_000);

  afterAll(async () => {
    await adapter?.close();
    await admin(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  });

  const connection = (name, provider = "openai") =>
    db.createProviderConnection({ provider, authType: "apikey", name, apiKey: `sk-${name}` });

  it("deletes an unscoped provider connection", async () => {
    const conn = await connection("solo");
    await expect(db.deleteProviderConnection(conn.id)).resolves.toBe(true);
    expect(await db.getProviderConnectionById(conn.id)).toBeNull();
  });

  it("deletes a scoped connection that is not the key's last one, and refuses the last one", async () => {
    const a = await connection("scoped-a");
    const b = await connection("scoped-b");
    const key = await db.createApiKey("scoped", "abcd1234", [], null, null, { providerConnectionIds: [a.id, b.id] });

    await expect(db.deleteProviderConnection(a.id)).resolves.toBe(true);
    await expect(db.deleteProviderConnection(b.id)).rejects.toMatchObject({ code: "API_KEY_SCOPE_WOULD_BROADEN" });

    await expect(db.deleteApiKey(key.id)).resolves.toBe(true);
    await expect(db.deleteProviderConnection(b.id)).resolves.toBe(true);
  });

  it("deletes every connection of a provider", async () => {
    await connection("bulk-1", "anthropic");
    await connection("bulk-2", "anthropic");
    await expect(db.deleteProviderConnectionsByProvider("anthropic")).resolves.toBe(2);
    expect(await db.getProviderConnections({ provider: "anthropic" })).toEqual([]);
  });

  it("deletes an API key with groups, scope and usage totals attached", async () => {
    const conn = await connection("for-key");
    const group = await db.createApiKeyGroup({ name: "delete-me" });
    const key = await db.createApiKey("full", "abcd1234", [], null, null, { providerConnectionIds: [conn.id] });
    await db.updateApiKey(key.id, { groupIds: [group.id] });
    await db.saveRequestUsage({
      provider: "openai", model: "gpt", apiKey: key.key, connectionId: conn.id,
      tokens: { prompt_tokens: 3, completion_tokens: 4 }, timestamp: new Date().toISOString(), status: "ok",
    });
    expect((await db.getApiKeyUsageTotals(key.id)).totalRequests).toBe(1);

    await expect(db.deleteApiKey(key.id)).resolves.toBe(true);
    expect(await db.getApiKeyById(key.id)).toBeNull();
    await expect(db.deleteApiKeyGroup(group.id)).resolves.toBe(true);
  });

  describe("through the dashboard routes", () => {
    let providerRoute;
    let nodeRoute;

    beforeAll(async () => {
      providerRoute = await import("@/app/api/providers/[id]/route.js");
      nodeRoute = await import("@/app/api/provider-nodes/[id]/route.js");
    });

    const call = (route, url, id) =>
      route.DELETE(new Request(url, { method: "DELETE" }), { params: Promise.resolve({ id }) });

    const quotaSnapshot = (connectionId, provider) => ({
      identity: { connectionId, provider, dimensionKey: "requests:session" },
      state: "available",
      amounts: { limitKind: "bounded", limit: 100, used: 10, remaining: 90, remainingRatio: 0.9, unit: "requests" },
      timing: { observedAt: new Date().toISOString(), staleAt: new Date(Date.now() + 3_600_000).toISOString(), resetAt: null, cooldownUntil: null },
      provenance: { sourceType: "provider_api", sourceId: `${provider}:quota:v1`, reasonCode: null, metadata: {} },
    });

    // Rows that hang off a connection: quota snapshot + fetch state, usage
    // last-seen, and a connection-group membership.
    async function attachDependents(conn) {
      await db.upsertProviderQuotaSnapshot(quotaSnapshot(conn.id, conn.provider));
      await db.saveRequestUsage({
        provider: conn.provider, model: "m", connectionId: conn.id,
        tokens: { prompt_tokens: 1, completion_tokens: 1 }, timestamp: new Date().toISOString(), status: "ok",
      });
      await db.createConnectionGroup({ name: `group-${conn.id.slice(0, 8)}`, connectionIds: [conn.id] });
    }

    function dependentCounts(id) {
      const count = (table) => adapter.get(`SELECT COUNT(*) AS c FROM ${table} WHERE connectionId = ?`, [id]).c;
      return ["providerQuotaSnapshots", "quotaFetchStates", "connectionGroupMembers"].map(count);
    }

    it("deletes an OAuth account with tokens, auto-ping, quota, usage and group rows", async () => {
      const conn = await db.createProviderConnection({
        provider: "claude", authType: "oauth", email: "owner@example.com", name: "claude-oauth",
        accessToken: "at-secret", refreshToken: "rt-secret", expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        isActive: true,
      });
      await db.setProviderConnectionAutoPing(conn.id, true);
      await attachDependents(conn);
      expect(dependentCounts(conn.id)).toEqual([1, 1, 1]);

      const res = await call(providerRoute, `http://localhost/api/providers/${conn.id}`, conn.id);
      expect(res.status).toBe(200);
      expect(await db.getProviderConnectionById(conn.id)).toBeNull();
      expect(dependentCounts(conn.id)).toEqual([0, 0, 0]);
      const settings = await db.getSettings();
      expect(settings.claudeAutoPing?.connections?.[conn.id]).toBeUndefined();
    });

    it("deletes an API-key account with quota, usage and group rows", async () => {
      const conn = await connection("route-apikey");
      await attachDependents(conn);

      const res = await call(providerRoute, `http://localhost/api/providers/${conn.id}`, conn.id);
      expect(res.status).toBe(200);
      expect(await db.getProviderConnectionById(conn.id)).toBeNull();
      expect(dependentCounts(conn.id)).toEqual([0, 0, 0]);
    });

    it("answers 409 for the last scoped account of a key and 404 once it is gone", async () => {
      const conn = await connection("route-scoped");
      const key = await db.createApiKey("route-scoped", "abcd1234", [], null, null, { providerConnectionIds: [conn.id] });
      const url = `http://localhost/api/providers/${conn.id}`;
      expect((await call(providerRoute, url, conn.id)).status).toBe(409);
      await db.deleteApiKey(key.id);
      expect((await call(providerRoute, url, conn.id)).status).toBe(200);
      expect((await call(providerRoute, url, conn.id)).status).toBe(404);
    });

    it("deletes a compatible provider node together with its accounts", async () => {
      const node = await db.createProviderNode({
        type: "openai-compatible", name: "Local", prefix: "local", apiType: "chat", baseUrl: "http://127.0.0.1:9",
      });
      const conn = await connection("node-account", node.id);
      const res = await call(nodeRoute, `http://localhost/api/provider-nodes/${node.id}`, node.id);
      expect(res.status).toBe(200);
      expect(await db.getProviderConnectionById(conn.id)).toBeNull();
      expect(await db.getProviderNodeById(node.id)).toBeNull();
    });
  });
});
