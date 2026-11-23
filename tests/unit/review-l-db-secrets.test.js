import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir;
let saved;
beforeEach(() => {
  saved = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-secrets-review-"));
  process.env.DATA_DIR = dir;
  delete process.env.DURINDOOR_DATABASE_ENV_SOURCE_JSON;
  delete process.env.DURINDOOR_PG_URL;
  vi.resetModules();
});
afterEach(() => {
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("database secret boundaries", () => {
  it("binds new connection blobs to their field and reads old ciphertext", async () => {
    const crypto = await import("@/lib/crypto/columnCrypto.js");
    const { encryptConnectionSecret, decryptConnectionSecret } = await import("@/lib/db/helpers/connectionSecrets.js");
    const old = crypto.encryptField("old", "row");
    expect(decryptConnectionSecret(old, "row", "apiKey")).toBe("old");
    expect(decryptConnectionSecret(crypto.encryptField("older"), "row", "apiKey")).toBe("older");
    const blob = encryptConnectionSecret("new", "row", "apiKey");
    expect(blob.v).toBe(2);
    expect(decryptConnectionSecret(blob, "row", "apiKey")).toBe("new");
    expect(() => decryptConnectionSecret(blob, "row", "accessToken")).toThrow();
    const { encryptPostgresUrl } = await import("@/lib/db/secrets.js");
    expect(() => decryptConnectionSecret(encryptPostgresUrl("postgres://u:p@host/db"), "postgres-url", "apiKey")).toThrow();
  });

  it("leaves other connections readable when one credential is corrupted", async () => {
    const repo = await import("@/lib/db/repos/connectionsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const first = await repo.createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "first" });
    await repo.createProviderConnection({ provider: "anthropic", authType: "apikey", apiKey: "second" });
    const db = await getAdapter();
    const row = db.get("SELECT data FROM providerConnections WHERE id = ?", [first.id]);
    const data = JSON.parse(row.data);
    data.apiKey.ct = "invalid";
    db.run("UPDATE providerConnections SET data = ? WHERE id = ?", [JSON.stringify(data), first.id]);
    const connections = await repo.getProviderConnections();
    expect(connections.find((c) => c.id === first.id).apiKey).toBeNull();
    expect(connections.find((c) => c.provider === "anthropic").apiKey).toBe("second");
    db.close();
    delete global._dbAdapter;
  });

  it("reuses a password only for the same host, port and user", async () => {
    const env = await import("@/lib/db/databaseEnvFile.js");
    env.writeDatabaseEnvFile({ DURINDOOR_PG_URL: "postgresql://alice:secret@db.example:5432/main" });
    const body = { engine: "postgres", host: "db.example", port: "5432", user: "alice", database: "main" };
    const password = (changes) => new URL(env.composeDatabaseStartup({ ...body, ...changes }).DURINDOOR_PG_URL).password;
    expect(password({})).toBe("secret");
    for (const changes of [{ host: "other" }, { port: "5433" }, { user: "bob" }]) expect(password(changes)).toBe("");
  });

  it("retains only three cutover snapshots", async () => {
    const snapshot = await import("@/lib/db/dialects/postgres/snapshot.js");
    const dbDir = path.join(dir, "db");
    const backups = path.join(dbDir, "backups");
    fs.mkdirSync(backups, { recursive: true });
    fs.writeFileSync(path.join(dbDir, "data.sqlite"), "db");
    for (let i = 0; i < 5; i++) {
      const file = path.join(backups, `${snapshot.SNAPSHOT_PREFIX}old-${i}.sqlite`);
      fs.writeFileSync(file, "old");
      fs.utimesSync(file, i + 1, i + 1);
    }
    await snapshot.snapshotSqlite();
    expect(snapshot.listSnapshots()).toHaveLength(3);
  });
});
