import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-scope-storage-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/localDb");
  const conn = await db.createProviderConnection({ provider: "groq", authType: "apikey", name: "Export me", apiKey: "secret" });
  return { ...db, conn, cleanup: async () => { vi.resetModules(); fs.rmSync(tempDir, { recursive: true, force: true }); } };
}

async function switchTo(tempDir) {
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  return await import("@/lib/localDb");
}

describe("API-key provider-account storage", () => {
  let cleanup = () => {};
  afterEach(async () => { await cleanup(); process.env.DATA_DIR = originalDataDir; vi.resetModules(); });

  it("migration 014 creates apiKeyProviderConnections and persists scoped relations", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const created = await ctx.createApiKey("Scoped", "machine", [], null, null, { providerConnectionIds: [ctx.conn.id] });
    expect(await ctx.getApiKeyProviderConnectionIds(created.id)).toEqual([ctx.conn.id]);
  });

  it("FK cascade removes scoped relation rows when the key is deleted", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const created = await ctx.createApiKey("Cascade", "machine", [], null, null, { providerConnectionIds: [ctx.conn.id] });
    await ctx.deleteApiKey(created.id);
    expect(await ctx.getApiKeyProviderConnectionIds(created.id)).toEqual([]);
  });

  it("round-trips relation rows through export and a fresh DATA_DIR import", async () => {
    const ctx = await setup();
    const created = await ctx.createApiKey("Round trip", "machine", [], null, null, { providerConnectionIds: [ctx.conn.id] });
    const dump = await ctx.exportDb();
    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-scope-storage-import-"));
    const reimport = await switchTo(importDir);
    await reimport.importDb(dump);
    expect(await reimport.getApiKeyProviderConnectionIds(created.id)).toEqual([ctx.conn.id]);
    cleanup = async () => {
      await ctx.cleanup();
      vi.resetModules();
      fs.rmSync(importDir, { recursive: true, force: true });
    };
  });

  it("rejects invalid scope writes inside the same transaction and leaves the key row untouched", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    await expect(ctx.createApiKey("Bad", "machine", [], null, null, { providerConnectionIds: ["nope"] })).rejects.toThrow(/not found/);
    expect(await ctx.getApiKeys()).toEqual([]);
    const stable = await ctx.createApiKey("Stable", "machine", [], null, null, { providerConnectionIds: [ctx.conn.id] });
    expect(await ctx.getApiKeyProviderConnectionIds(stable.id)).toEqual([ctx.conn.id]);
    await expect(ctx.updateApiKey(stable.id, { name: "Hacked", providerConnectionIds: ["nope"] })).rejects.toThrow(/not found/);
    const untouched = await ctx.getApiKeyById(stable.id);
    expect(untouched.name).toBe("Stable");
    expect(await ctx.getApiKeyProviderConnectionIds(stable.id)).toEqual([ctx.conn.id]);
  });
});
