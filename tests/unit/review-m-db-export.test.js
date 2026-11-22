/**
 * Regression coverage for portable DB export/import:
 * - #2208 scrubbed export drops API-key / MFA / OIDC secrets
 * - #2297 import keeps live mfa fields, password, passwordSessionEpoch; route lockout
 * - #2260 export/import round-trips apiKey groups, MCP, capability overrides, captures
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";
import { TABLES } from "../../src/lib/db/schema.js";

let tempDir;
let originalDataDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-m-db-export-"));
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

describe("#2208 scrubbed export drops listed secrets", () => {
  it("drops apiKeys[].key and secret settings when includeSecrets is false", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const apiSecret = "sk-live-gateway-secret-deadbeef";
    const mfaSecret = "JBSWY3DPEHPK3PXP";
    const oidcSecret = "oidc-client-secret-value";
    const backupCodes = ["hash-one", "hash-two"];

    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)`,
      ["key-1", apiSecret, "Live", new Date().toISOString()],
    );
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?)`,
      [JSON.stringify({
        oidcClientSecret: oidcSecret,
        mfaSecret,
        mfaBackupCodes: backupCodes,
        mfaEnabled: true,
        postgresUrl: "postgres://user:pass@localhost/db",
        cloudEnabled: true,
      })],
    );

    const scrubbed = await database.exportDb({ includeSecrets: false });
    const text = JSON.stringify(scrubbed);

    expect(scrubbed.apiKeys[0].id).toBe("key-1");
    expect(scrubbed.apiKeys[0]).not.toHaveProperty("key");
    expect(text).not.toContain(apiSecret);
    expect(text).not.toContain(oidcSecret);
    expect(text).not.toContain(mfaSecret);
    expect(text).not.toContain("hash-one");
    expect(scrubbed.settings.cloudEnabled).toBe(true);
    expect(scrubbed.settings).not.toHaveProperty("oidcClientSecret");
    expect(scrubbed.settings).not.toHaveProperty("mfaSecret");
    expect(scrubbed.settings).not.toHaveProperty("mfaBackupCodes");
    expect(scrubbed.settings).not.toHaveProperty("postgresUrl");

    const full = await database.exportDb({ includeSecrets: true });
    expect(full.apiKeys[0].key).toBe(apiSecret);
    expect(full.settings.oidcClientSecret).toBe(oidcSecret);
    expect(full.settings.mfaSecret).toBe(mfaSecret);
    expect(full.settings.mfaBackupCodes).toEqual(backupCodes);
  });
});

describe("#2297 import keeps live auth; route applies lockout", () => {
  it("importDb keeps current mfa*, password and passwordSessionEpoch", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const live = {
      password: "live-password-hash",
      passwordSessionEpoch: "epoch-live",
      mfaEnabled: true,
      mfaSecret: "LIVESECRETSEEDXX",
      mfaBackupCodes: ["live-hash"],
      cloudEnabled: false,
    };
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?)`, [JSON.stringify(live)]);

    await database.importDb({
      settings: {
        password: "attacker-hash",
        passwordSessionEpoch: "epoch-attacker",
        mfaEnabled: false,
        mfaSecret: "ATTACKERSEEDXXXX",
        mfaBackupCodes: [],
        cloudEnabled: true,
      },
      apiKeys: [],
      usageEventReceipts: [],
      usageEventReceiptsVersion: 1,
    });

    const stored = JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data);
    expect(stored.password).toBe("live-password-hash");
    expect(stored.passwordSessionEpoch).toBe("epoch-live");
    expect(stored.mfaEnabled).toBe(true);
    expect(stored.mfaSecret).toBe("LIVESECRETSEEDXX");
    expect(stored.mfaBackupCodes).toEqual(["live-hash"]);
    expect(stored.cloudEnabled).toBe(true);
  });

  it("requireDatabaseDualAuth records failures and blocks when locked", async () => {
    vi.resetModules();
    vi.doMock("@/lib/localDb", () => ({
      exportDb: vi.fn(async () => ({})),
      importDb: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => ({})),
    }));
    vi.doMock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
    vi.doMock("@/shared/services/quotaAutoPing", () => ({ startQuotaAutoPing: vi.fn() }));
    vi.doMock("@/lib/auth/dashboardSession", () => ({
      verifyDashboardPassword: vi.fn(async (password) => password === "ok"),
    }));
    vi.doMock("@/dashboardGuard", () => ({
      hasValidCliToken: vi.fn(async () => true),
      hasValidToken: vi.fn(async () => false),
    }));

    const limiter = await import("../../src/lib/auth/loginLimiter.js");
    limiter.resetLoginLimiter();

    try {
      const { requireDatabaseDualAuth, GET } = await import("../../src/app/api/settings/database/route.js");

      const req = (password) => new Request("http://localhost/api/settings/database", {
        method: "GET",
        headers: { "x-9r-password": password },
      });

      for (let i = 0; i < 5; i++) {
        await expect(requireDatabaseDualAuth(req("nope"), "nope")).resolves.toBe(false);
      }
      // Without wrapper-stamped peer headers, attempts share the "unknown" bucket.
      expect(limiter.checkLock("unknown").locked).toBe(true);
      await expect(requireDatabaseDualAuth(req("ok"), "ok")).resolves.toBe(false);

      const locked = await GET(req("ok"));
      expect(locked.status).toBe(429);
      expect((await locked.json()).retryAfter).toBeGreaterThan(0);
    } finally {
      limiter.resetLoginLimiter();
      vi.resetModules();
      vi.doUnmock("@/lib/localDb");
      vi.doUnmock("@/lib/network/outboundProxy");
      vi.doUnmock("@/shared/services/quotaAutoPing");
      vi.doUnmock("@/lib/auth/dashboardSession");
      vi.doUnmock("@/dashboardGuard");
    }
  });
});

describe("#2260 export/import round-trips user-data tables", () => {
  it("declares sessionCaptureTurns in TABLES for schema/mirror parity", () => {
    expect(TABLES.sessionCaptureTurns).toBeTruthy();
    expect(Object.keys(TABLES.sessionCaptureTurns.columns)).toEqual([
      "id", "apiKeyId", "sessionId", "content", "byteSize", "createdAt", "expiresAt",
    ]);
  });

  it("round-trips apiKey groups, MCP tables, capability overrides and captures", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = "2026-06-01T00:00:00.000Z";
    const expires = "2099-01-01T00:00:00.000Z";

    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)`,
      ["key-1", "sk-roundtrip-secret", "Roundtrip", now],
    );
    db.run(
      `INSERT INTO apiKeyGroups(id, name, description, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      ["grp-1", "CI", "group", now, now],
    );
    db.run(
      `INSERT INTO apiKeyGroupMembers(groupId, apiKeyId, createdAt) VALUES(?, ?, ?)`,
      ["grp-1", "key-1", now],
    );
    db.run(
      `INSERT INTO mcpInstances(id, slug, title, kind, transport, url, command, args, env, headers, oauth, oauthTokens, providerConnectionId, enabled, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 1, ?)`,
      ["mcp-1", "demo", "Demo", "custom", "stdio", null, "echo", "[]", "{}", "{}", now],
    );
    db.run(
      `INSERT INTO mcpGatewayKeys(id, name, key, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)`,
      ["gw-1", "gw", "sk-mcp-gateway-secret", "machine", now],
    );
    db.run(
      `INSERT INTO mcpKeyGrants(keyId, instanceId, toolAllowlist) VALUES(?, ?, ?)`,
      ["gw-1", "mcp-1", JSON.stringify(["list"])],
    );
    db.run(
      `INSERT INTO modelCapabilityOverrides(provider, modelId, overrideKey, overrideValue, refreshedAt)
       VALUES(?, ?, ?, ?, ?)`,
      ["openai", "gpt-test", "maxTokens", "4096", now],
    );
    db.run(
      `INSERT INTO "sessionCaptureTurns" ("id", "apiKeyId", "sessionId", "content", "byteSize", "createdAt", "expiresAt")
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["turn-1", "key-1", "sess-1", '{"user":["hi"]}', 15, now, expires],
    );

    const snapshot = await database.exportDb({ includeSecrets: true });
    expect(snapshot.apiKeyGroups).toEqual([
      expect.objectContaining({ id: "grp-1", name: "CI" }),
    ]);
    expect(snapshot.apiKeyGroupMembers).toEqual([
      expect.objectContaining({ groupId: "grp-1", apiKeyId: "key-1" }),
    ]);
    expect(snapshot.mcpInstances).toEqual([
      expect.objectContaining({ id: "mcp-1", slug: "demo" }),
    ]);
    expect(snapshot.mcpGatewayKeys).toEqual([
      expect.objectContaining({ id: "gw-1", key: "sk-mcp-gateway-secret" }),
    ]);
    expect(snapshot.mcpKeyGrants).toEqual([
      expect.objectContaining({ keyId: "gw-1", instanceId: "mcp-1", toolAllowlist: ["list"] }),
    ]);
    expect(snapshot.modelCapabilityOverrides).toEqual([
      expect.objectContaining({ provider: "openai", modelId: "gpt-test", overrideKey: "maxTokens", overrideValue: "4096" }),
    ]);
    expect(snapshot.sessionCaptureTurns).toEqual([
      expect.objectContaining({ id: "turn-1", apiKeyId: "key-1", sessionId: "sess-1" }),
    ]);

    // Mutate local state so a no-op restore would leave the wrong shape.
    db.run(`DELETE FROM apiKeyGroupMembers`);
    db.run(`DELETE FROM apiKeyGroups`);
    db.run(`DELETE FROM mcpKeyGrants`);
    db.run(`DELETE FROM mcpGatewayKeys`);
    db.run(`DELETE FROM mcpInstances`);
    db.run(`DELETE FROM modelCapabilityOverrides`);
    db.run('DELETE FROM "sessionCaptureTurns"');

    await database.importDb(snapshot);

    expect(db.get(`SELECT COUNT(*) AS n FROM apiKeyGroups`).n).toBe(1);
    expect(db.get(`SELECT COUNT(*) AS n FROM apiKeyGroupMembers`).n).toBe(1);
    expect(db.get(`SELECT groupId, apiKeyId FROM apiKeyGroupMembers`).apiKeyId).toBe("key-1");
    expect(db.get(`SELECT slug FROM mcpInstances WHERE id = 'mcp-1'`).slug).toBe("demo");
    expect(db.get(`SELECT key FROM mcpGatewayKeys WHERE id = 'gw-1'`).key).toBe("sk-mcp-gateway-secret");
    expect(db.get(`SELECT toolAllowlist FROM mcpKeyGrants WHERE keyId = 'gw-1'`).toolAllowlist).toBe(JSON.stringify(["list"]));
    expect(db.get(
      `SELECT overrideValue FROM modelCapabilityOverrides WHERE provider = 'openai' AND modelId = 'gpt-test' AND overrideKey = 'maxTokens'`
    ).overrideValue).toBe("4096");
    expect(db.get('SELECT content FROM "sessionCaptureTurns" WHERE "id" = ?', ["turn-1"]).content).toBe('{"user":["hi"]}');
  });
});
