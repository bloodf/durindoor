/**
 * Regression for #2440: scrubbed exports must drop proxy pool relaySecret and
 * every schema-secret setting; relaySecret is encrypted at rest; a scrubbed
 * restore keeps the live values.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let tempDir;
let originalDataDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-w-export-scrub-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const SECRET_SETTINGS = {
  password: "hash-of-password",
  passwordSessionEpoch: "epoch-secret",
  mitmSudoEncrypted: "sudo-secret-blob",
  operatorWebhooks: [{ url: "https://hook.example/x", secret: "hook-signing-secret" }],
  openrouterRouting: { order: ["secret-route-provider"] },
  postgresUrl: "postgres://user:pg-secret@db.example/app",
  oidcClientSecret: "oidc-secret-value",
  mfaSecret: "mfa-secret-value",
  mfaBackupCodes: ["backup-code-secret"],
};
const NON_SECRET_SETTING = { theme: "dark", mfaEnabled: true };

async function seed() {
  const database = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  db.run(
    `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    [JSON.stringify({ ...SECRET_SETTINGS, ...NON_SECRET_SETTING })],
  );
  const pool = await database.createProxyPool({
    name: "relay",
    proxyUrl: "https://relay.example",
    type: "vercel",
    relaySecret: "relay-secret-value",
  });
  return { database, db, pool };
}

describe("export scrub for relaySecret and schema-secret settings (#2440)", () => {
  it("drops relaySecret and every secret setting from scrubbed exports", async () => {
    const { database } = await seed();
    const scrubbed = await database.exportDb();
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain("relay-secret-value");
    expect(scrubbed.proxyPools[0]).not.toHaveProperty("relaySecret");
    for (const key of Object.keys(SECRET_SETTINGS)) expect(scrubbed.settings).not.toHaveProperty(key);
    expect(scrubbed.settings).toMatchObject(NON_SECRET_SETTING);
  });

  it("keeps everything with includeSecrets=true, relaySecret decrypted", async () => {
    const { database } = await seed();
    const full = await database.exportDb({ includeSecrets: true });
    expect(full.proxyPools[0].relaySecret).toBe("relay-secret-value");
    expect(full.settings).toMatchObject({ ...SECRET_SETTINGS, ...NON_SECRET_SETTING });
  });

  it("scrubProxyPoolForExport removes relaySecret", async () => {
    const { scrubProxyPoolForExport } = await import("@/lib/db/helpers/providerSpecificDataSecrets.js");
    const out = scrubProxyPoolForExport({ id: "p", proxyUrl: "https://relay.example", relaySecret: "s" });
    expect(out).not.toHaveProperty("relaySecret");
    expect(out.proxyUrl).toBe("https://relay.example");
  });

  it("encrypts relaySecret at rest, decrypts on read, and still reads legacy plaintext", async () => {
    const { database, db, pool } = await seed();
    const { isEncryptedBlob } = await import("../../src/lib/crypto/columnCrypto.js");
    const stored = JSON.parse(db.get(`SELECT data FROM proxyPools WHERE id = ?`, [pool.id]).data);
    expect(isEncryptedBlob(stored.relaySecret)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("relay-secret-value");
    expect((await database.getProxyPoolById(pool.id)).relaySecret).toBe("relay-secret-value");
    expect((await database.getProxyPools())[0].relaySecret).toBe("relay-secret-value");

    const updated = await database.updateProxyPool(pool.id, { name: "renamed" });
    expect(updated.relaySecret).toBe("relay-secret-value");
    const restored = JSON.parse(db.get(`SELECT data FROM proxyPools WHERE id = ?`, [pool.id]).data);
    expect(isEncryptedBlob(restored.relaySecret)).toBe(true);

    db.run(
      `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, 1, 'unknown', ?, ?, ?)`,
      ["legacy-pool", JSON.stringify({ name: "old", proxyUrl: "https://old.example", relaySecret: "legacy-plain" }), "2020-01-01", "2020-01-01"],
    );
    expect((await database.getProxyPoolById("legacy-pool")).relaySecret).toBe("legacy-plain");
  });

  it("keeps live relaySecret and secret settings when a scrubbed export is imported", async () => {
    const { database, db, pool } = await seed();
    const scrubbed = await database.exportDb();
    await database.importDb(scrubbed);

    expect((await database.getProxyPoolById(pool.id)).relaySecret).toBe("relay-secret-value");
    const settings = JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data);
    expect(settings).toMatchObject({ ...SECRET_SETTINGS, ...NON_SECRET_SETTING });
  });

  it("encrypts relaySecret when importing a full export", async () => {
    const { database, db, pool } = await seed();
    const { isEncryptedBlob } = await import("../../src/lib/crypto/columnCrypto.js");
    const full = await database.exportDb({ includeSecrets: true });
    await database.importDb(full);
    const stored = JSON.parse(db.get(`SELECT data FROM proxyPools WHERE id = ?`, [pool.id]).data);
    expect(isEncryptedBlob(stored.relaySecret)).toBe(true);
    expect((await database.getProxyPoolById(pool.id)).relaySecret).toBe("relay-secret-value");
  });
});
