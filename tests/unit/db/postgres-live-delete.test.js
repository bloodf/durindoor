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
});
