/**
 * Regression for #2281: providerSpecificData secrets must be encrypted at rest
 * and removed from scrubbed exportDb payloads (includeSecrets:false).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEncryptedBlob } from "../../src/lib/crypto/columnCrypto.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-psd-secrets-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function freshRepo() {
  return import("@/lib/db/repos/connectionsRepo.js");
}

async function freshLocalDb() {
  return import("@/lib/db/index.js");
}

async function freshDb() {
  const driver = await import("@/lib/db/driver.js");
  return driver.getAdapter();
}

const PSD_SECRETS = {
  cookie: "BXAuth=iflow-session-cookie-value;",
  clientSecret: "kiro-idc-client-secret-value",
  mimoPassToken: "xiaomi-mimo-pass-token-value",
  dcaToken: "dca:muse-code-token-value",
  copilotToken: "ghu_copilot-token-value",
  extraApiKeys: ["extra-api-key-one", "extra-api-key-two"]
};

describe("review-s-psd-secrets (#2281)", () => {
  it("encrypts nested providerSpecificData secrets at rest and decrypts on read", async () => {
    const repo = await freshRepo();
    const conn = await repo.createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      name: "psd-enc",
      email: "psd@example.com",
      providerSpecificData: {
        ...PSD_SECRETS,
        region: "us-east-1",
        authMethod: "idc",
        profileArn: "arn:aws:example"
      }
    });

    const db = await freshDb();
    const row = db.get(`SELECT data FROM providerConnections WHERE id = ?`, [conn.id]);
    const parsed = JSON.parse(row.data);
    const psd = parsed.providerSpecificData;

    for (const key of Object.keys(PSD_SECRETS)) {
      if (key === "extraApiKeys") {
        expect(Array.isArray(psd.extraApiKeys)).toBe(true);
        expect(psd.extraApiKeys.every((item) => isEncryptedBlob(item))).toBe(true);
      } else {
        expect(isEncryptedBlob(psd[key])).toBe(true);
      }
    }
    expect(psd.region).toBe("us-east-1");
    expect(psd.authMethod).toBe("idc");

    for (const secret of [
      "iflow-session-cookie-value",
      "kiro-idc-client-secret-value",
      "xiaomi-mimo-pass-token-value",
      "muse-code-token-value",
      "ghu_copilot-token-value",
      "extra-api-key-one",
      "extra-api-key-two"
    ]) {
      expect(row.data).not.toContain(secret);
    }

    const read = await repo.getProviderConnectionById(conn.id);
    expect(read.providerSpecificData).toMatchObject({
      ...PSD_SECRETS,
      region: "us-east-1",
      authMethod: "idc",
      profileArn: "arn:aws:example"
    });
  });

  it("keeps reading legacy plaintext providerSpecificData secrets", async () => {
    const db = await freshDb();
    const id = "legacy-psd-conn";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        "xiaomi-mimo",
        "oauth",
        "legacy-psd",
        "legacy@example.com",
        1,
        1,
        JSON.stringify({
          providerSpecificData: {
            mimoPassToken: "legacy-pass-token",
            region: "sgp",
            authMethod: "session"
          }
        }),
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );
    const repo = await freshRepo();
    const read = await repo.getProviderConnectionById(id);
    expect(read.providerSpecificData.mimoPassToken).toBe("legacy-pass-token");
    expect(read.providerSpecificData.region).toBe("sgp");
  });

  it("scrubbed exportDb drops nested PSD secrets while keeping allowlisted metadata", async () => {
    const repo = await freshRepo();
    await repo.createProviderConnection({
      provider: "iflow",
      authType: "cookie",
      name: "scrub-psd",
      accessToken: "AT-top-level",
      providerSpecificData: {
        ...PSD_SECRETS,
        region: "cn",
        authMethod: "cookie",
        githubLogin: "octocat"
      }
    });

    const localDb = await freshLocalDb();
    const exported = await localDb.exportDb();
    expect(exported.providerConnections).toHaveLength(1);
    const row = exported.providerConnections[0];
    expect(row.accessToken).toBeUndefined();
    expect(row.providerSpecificData.cookie).toBeUndefined();
    expect(row.providerSpecificData.clientSecret).toBeUndefined();
    expect(row.providerSpecificData.mimoPassToken).toBeUndefined();
    expect(row.providerSpecificData.dcaToken).toBeUndefined();
    expect(row.providerSpecificData.copilotToken).toBeUndefined();
    expect(row.providerSpecificData.extraApiKeys).toBeUndefined();
    expect(row.providerSpecificData.region).toBe("cn");
    expect(row.providerSpecificData.authMethod).toBe("cookie");
    expect(row.providerSpecificData.githubLogin).toBe("octocat");

    const blob = JSON.stringify(exported);
    for (const secret of [
      "iflow-session-cookie-value",
      "kiro-idc-client-secret-value",
      "xiaomi-mimo-pass-token-value",
      "muse-code-token-value",
      "ghu_copilot-token-value",
      "extra-api-key-one",
      "AT-top-level"
    ]) {
      expect(blob).not.toContain(secret);
    }
  });

  it("includeSecrets exportDb decrypts nested PSD secrets to portable plaintext", async () => {
    const repo = await freshRepo();
    await repo.createProviderConnection({
      provider: "muse-code",
      authType: "oauth",
      name: "full-psd",
      providerSpecificData: {
        dcaToken: "dca:portable-secret",
        authKind: "oauth",
        region: "us"
      }
    });
    const localDb = await freshLocalDb();
    const exported = await localDb.exportDb({ includeSecrets: true });
    expect(exported.providerConnections[0].providerSpecificData.dcaToken).toBe("dca:portable-secret");
    expect(exported.providerConnections[0].providerSpecificData.authKind).toBe("oauth");
  });

  it("scrubbed exportDb removes proxy URL passwords, outboundProxyUrl credentials, and webhook secrets", async () => {
    const db = await freshDb();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?)`,
      [JSON.stringify({
        postgresUrl: "postgres://db:secret@localhost/app",
        outboundProxyUrl: "http://proxy-user:proxy-pass@proxy.example:8080",
        operatorWebhooks: [
          { id: "hook-1", url: "https://hooks.example/a", secret: "webhook-signing-secret" }
        ],
        theme: "system"
      })]
    );
    db.run(
      `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
       VALUES(?, 1, 'ok', ?, ?, ?)`,
      [
        "pool-1",
        JSON.stringify({
          name: "corp",
          proxyUrl: "http://pool-user:pool-pass@pool.example:3128",
          type: "http"
        }),
        now,
        now
      ]
    );

    const localDb = await freshLocalDb();
    const exported = await localDb.exportDb();
    expect(exported.settings.postgresUrl).toBeUndefined();
    expect(exported.settings.outboundProxyUrl).toBeUndefined();
    expect(exported.settings.operatorWebhooks[0].secret).toBeUndefined();
    expect(exported.settings.operatorWebhooks[0].url).toBe("https://hooks.example/a");
    expect(exported.settings.theme).toBe("system");
    expect(exported.proxyPools[0].proxyUrl).toBeUndefined();
    expect(exported.proxyPools[0].name).toBe("corp");

    const blob = JSON.stringify(exported);
    for (const secret of ["proxy-pass", "pool-pass", "webhook-signing-secret", "postgres://db:secret"]) {
      expect(blob).not.toContain(secret);
    }
  });
});
