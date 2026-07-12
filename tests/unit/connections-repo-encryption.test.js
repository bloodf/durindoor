// SEC-B-02: connectionsRepo encryption + exportDb sanitization tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-conn-crypto-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function freshDb() {
  const driver = await import("@/lib/db/driver.js");
  return driver.getAdapter();
}

async function freshRepo() {
  return import("@/lib/db/repos/connectionsRepo.js");
}

async function freshLocalDb() {
  return import("@/lib/db/index.js");
}

describe("connectionsRepo encryption (SEC-B-02)", () => {
  it("stores accessToken/refreshToken/apiKey/idToken as encrypted blobs at rest", async () => {
    const repo = await freshRepo();
    const conn = await repo.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "enc-test",
      accessToken: "AT-secret-1",
      refreshToken: "RT-secret-2",
      apiKey: "sk-secret-3",
      idToken: "ID-secret-4",
      email: "enc@example.com",
    });

    const db = await freshDb();
    const row = db.get(`SELECT data FROM providerConnections WHERE id = ?`, [conn.id]);
    const parsed = JSON.parse(row.data);

    for (const field of repo.SENSITIVE_CONNECTION_FIELDS) {
      const value = parsed[field];
      expect(typeof value).toBe("object");
      expect(value).toHaveProperty("v", 1);
      expect(value).toHaveProperty("iv");
      expect(value).toHaveProperty("ct");
      // Plaintext never appears in the JSON column.
      expect(row.data).not.toContain("AT-secret-1");
      expect(row.data).not.toContain("RT-secret-2");
      expect(row.data).not.toContain("sk-secret-3");
      expect(row.data).not.toContain("ID-secret-4");
    }
  });

  it("decrypts on read so callers see plaintext", async () => {
    const repo = await freshRepo();
    const conn = await repo.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "roundtrip",
      accessToken: "AT-roundtrip",
      refreshToken: "RT-roundtrip",
      email: "rt@example.com",
    });
    const read = await repo.getProviderConnectionById(conn.id);
    expect(read.accessToken).toBe("AT-roundtrip");
    expect(read.refreshToken).toBe("RT-roundtrip");
  });

  it("update preserves ciphertext and only rewrites on new plaintext", async () => {
    const repo = await freshRepo();
    const conn = await repo.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "update-me",
      accessToken: "AT-before",
      refreshToken: "RT-before",
      email: "up@example.com",
    });
    await repo.updateProviderConnection(conn.id, { name: "updated" });
    const read = await repo.getProviderConnectionById(conn.id);
    // Plaintext survives the update cycle even though the ciphertext has
    // been re-encrypted under a fresh IV.
    expect(read.accessToken).toBe("AT-before");
    expect(read.refreshToken).toBe("RT-before");
    expect(read.name).toBe("updated");
    const db = await freshDb();
    const row = db.get(`SELECT data FROM providerConnections WHERE id = ?`, [conn.id]);
    expect(row.data).not.toContain("AT-before");
    expect(row.data).not.toContain("RT-before");
  });

  it("binds ciphertext to the row id (AAD) — swapping rows fails decryption", async () => {
    const repo = await freshRepo();
    const a = await repo.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "A",
      accessToken: "AT-A",
      email: "a@example.com",
    });
    const b = await repo.createProviderConnection({
      provider: "anthropic",
      authType: "oauth",
      name: "B",
      accessToken: "AT-B",
      email: "b@example.com",
    });
    const db = await freshDb();
    const rowA = db.get(`SELECT data FROM providerConnections WHERE id = ?`, [a.id]);
    const parsedA = JSON.parse(rowA.data);
    // Rewrite row B's data column with row A's blob — same ciphertext, wrong AAD.
    db.run(
      `UPDATE providerConnections SET data = ? WHERE id = ?`,
      [JSON.stringify(parsedA), b.id],
    );
    await expect(repo.getProviderConnectionById(b.id)).rejects.toThrow();
  });

  it("reads legacy plaintext rows (pre-migration compat)", async () => {
    const db = await freshDb();
    const id = "legacy-conn-id";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        "openai",
        "oauth",
        "legacy",
        "legacy@example.com",
        1,
        1,
        JSON.stringify({ accessToken: "AT-legacy", refreshToken: "RT-legacy" }),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    const repo = await freshRepo();
    const read = await repo.getProviderConnectionById(id);
    expect(read.accessToken).toBe("AT-legacy");
    expect(read.refreshToken).toBe("RT-legacy");
  });

  it("migration 009 encrypts legacy plaintext in place and is idempotent", async () => {
    // Seed a legacy row with plaintext credentials directly via the runtime
    // adapter, then invoke migration 009's `up()` twice and assert the data
    // column ends up as an encrypted blob (and stays stable across reruns).
    const db = await freshDb();
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "m1",
        "openai",
        "oauth",
        "mig",
        JSON.stringify({ accessToken: "AT-mig", refreshToken: "RT-mig" }),
        "now",
        "now",
      ],
    );

    const migration = (await import("@/lib/db/migrations/009-encrypt-credentials.js")).default;
    migration.up(db);
    const row = db.get(`SELECT data FROM providerConnections WHERE id = 'm1'`);
    const parsed = JSON.parse(row.data);
    expect(typeof parsed.accessToken).toBe("object");
    expect(parsed.accessToken).toHaveProperty("v", 1);
    expect(parsed.accessToken).toHaveProperty("iv");
    expect(parsed.accessToken).toHaveProperty("ct");

    // Idempotent: re-running must not double-encrypt.
    migration.up(db);
    const row2 = db.get(`SELECT data FROM providerConnections WHERE id = 'm1'`);
    expect(row2.data).toBe(row.data);

    // And the repo decrypts the migrated row.
    const repo = await freshRepo();
    const read = await repo.getProviderConnectionById("m1");
    expect(read.accessToken).toBe("AT-mig");
    expect(read.refreshToken).toBe("RT-mig");
  });
});

describe("exportDb sanitization (SEC-B-02)", () => {
  it("scrubs credential fields by default", async () => {
    const repo = await freshRepo();
    await repo.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "scrub-me",
      accessToken: "AT-scrub",
      refreshToken: "RT-scrub",
      email: "scrub@example.com",
    });
    const localDb = await freshLocalDb();
    const exported = await localDb.exportDb();
    expect(exported.providerConnections).toHaveLength(1);
    const row = exported.providerConnections[0];
    expect(row.accessToken).toBeUndefined();
    expect(row.refreshToken).toBeUndefined();
    expect(row.apiKey).toBeUndefined();
    expect(row.idToken).toBeUndefined();
    expect(row.email).toBe("scrub@example.com");
    expect(row.name).toBe("scrub-me");
  });

  it("includeSecrets=true decrypts to portable plaintext", async () => {
    const repo = await freshRepo();
    await repo.createProviderConnection({
      provider: "openai",
      authType: "oauth",
      name: "full-backup",
      accessToken: "AT-portable",
      refreshToken: "RT-portable",
      email: "portable@example.com",
    });
    const localDb = await freshLocalDb();
    const exported = await localDb.exportDb({ includeSecrets: true });
    expect(exported.providerConnections).toHaveLength(1);
    const row = exported.providerConnections[0];
    expect(row.accessToken).toBe("AT-portable");
    expect(row.refreshToken).toBe("RT-portable");
  });
});
