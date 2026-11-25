import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let tempDir;
let originalDataDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-w-db-secrets-"));
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

describe("database secret handling regressions #2436 and #2440", () => {
  it("encrypts credentialed PSD URLs, decrypts them on read, and leaves plain URLs unchanged", async () => {
    const repo = await import("@/lib/db/repos/connectionsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { isEncryptedBlob } = await import("../../src/lib/crypto/columnCrypto.js");
    const connection = await repo.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "proxy fixture",
      providerSpecificData: {
        connectionProxyUrl: "http://proxy-user:proxy-password@proxy.example:8080",
        baseUrl: "https://api.example/v1",
      },
    });
    const id = connection.id;

    const db = await getAdapter();
    const stored = JSON.parse(db.get("SELECT data FROM providerConnections WHERE id = ?", [id]).data);
    expect(isEncryptedBlob(stored.providerSpecificData.connectionProxyUrl)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("proxy-password");
    expect(stored.providerSpecificData.baseUrl).toBe("https://api.example/v1");
    const read = await repo.getProviderConnectionById(id);
    expect(read.providerSpecificData.connectionProxyUrl).toBe("http://proxy-user:proxy-password@proxy.example:8080");
    expect(read.providerSpecificData.baseUrl).toBe("https://api.example/v1");

    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["legacy-url", "openai", "apikey", "legacy", JSON.stringify({
        providerSpecificData: { connectionProxyUrl: "http://legacy-user:legacy-pass@proxy.example:8080" },
      }), now(), now()],
    );
    const legacy = await repo.getProviderConnectionById("legacy-url");
    expect(legacy.providerSpecificData.connectionProxyUrl).toBe("http://legacy-user:legacy-pass@proxy.example:8080");
  });

  it("scrubs MCP credentials by default, keeps full exports, and preserves secrets on scrubbed restore", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = new Date().toISOString();
    const secretFixture = {
      env: { TOKEN: "mcp-env-secret" },
      headers: { Authorization: "Bearer mcp-header-secret" },
      oauthTokens: { accessToken: "mcp-access-secret", refreshToken: "mcp-refresh-secret" },
    };
    db.run(
      `INSERT INTO mcpInstances(id, slug, title, kind, transport, url, command, args, env, headers, oauth, oauthTokens, enabled, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?)`,
      ["mcp-secret", "secret-fixture", "Fixture", "custom", "http", "https://mcp-user:mcp-url-secret@mcp.example/sse", null, null,
        JSON.stringify(secretFixture.env), JSON.stringify(secretFixture.headers), JSON.stringify(secretFixture.oauthTokens), now],
    );

    const scrubbed = await database.exportDb();
    const scrubbedText = JSON.stringify(scrubbed);
    for (const secret of ["mcp-env-secret", "mcp-header-secret", "mcp-access-secret", "mcp-refresh-secret", "mcp-url-secret"]) {
      expect(scrubbedText).not.toContain(secret);
    }
    expect(scrubbed.mcpInstances[0]).toMatchObject({ env: null, headers: null, oauthTokens: null, url: null });

    const full = await database.exportDb({ includeSecrets: true });
    expect(full.mcpInstances[0].env).toEqual(secretFixture.env);
    expect(full.mcpInstances[0].headers).toEqual(secretFixture.headers);
    expect(full.mcpInstances[0].oauthTokens).toEqual(secretFixture.oauthTokens);
    expect(full.mcpInstances[0].url).toBe("https://mcp-user:mcp-url-secret@mcp.example/sse");

    await database.importDb(scrubbed);
    const restored = db.get("SELECT url, env, headers, oauthTokens FROM mcpInstances WHERE id = ?", ["mcp-secret"]);
    expect(restored.url).toBe("https://mcp-user:mcp-url-secret@mcp.example/sse");
    expect(JSON.parse(restored.env)).toEqual(secretFixture.env);
    expect(JSON.parse(restored.headers)).toEqual(secretFixture.headers);
    expect(JSON.parse(restored.oauthTokens)).toEqual(secretFixture.oauthTokens);
  });
});

function now() {
  return new Date().toISOString();
}
