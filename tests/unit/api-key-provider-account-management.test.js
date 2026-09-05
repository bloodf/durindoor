import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-key-scope-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) }
  }));
  const keys = await import("@/app/api/keys/route.js");
  const key = await import("@/app/api/keys/[id]/route.js");
  const provider = await import("@/app/api/providers/[id]/route.js");
  const node = await import("@/app/api/provider-nodes/[id]/route.js");
  const db = await import("@/lib/localDb");
  const connection = await db.createProviderConnection({ provider: "groq", authType: "apikey", name: "Scoped", apiKey: "secret" });
  await db.createProviderNode({ id: "node-1", type: "openai-compatible", name: "Node", prefix: "node", baseUrl: "https://example.com" });
  return {
    keysGET: keys.GET,
    keysPOST: keys.POST,
    keyPUT: key.PUT,
    providerDelete: provider.DELETE,
    nodeDelete: node.DELETE,
    ...db,
    connection,
    cleanup: async () => {
      vi.resetModules();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function request(url, method, body) {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("API-key provider-account management", () => {
  let cleanup = () => {};
  afterEach(async () => { await cleanup(); process.env.DATA_DIR = originalDataDir; vi.resetModules(); });

  it("creates, reloads, updates, clears scope, and never returns provider credential metadata", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const created = await ctx.keysPOST(request("https://d.local/api/keys", "POST", { name: "Scoped", providerConnectionIds: [ctx.connection.id] }));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.key).toMatch(/^sk-/);
    expect(createdBody.providerConnectionIds).toEqual([ctx.connection.id]);
    const listedBody = await (await ctx.keysGET()).json();
    expect(listedBody.providerConnections).toEqual([{ id: ctx.connection.id, name: "Scoped", provider: "groq" }]);
    expect(JSON.stringify(listedBody)).not.toContain("secret");
    expect(listedBody.keys.find((key) => key.id === createdBody.id).providerConnectionIds).toEqual([ctx.connection.id]);
    const cleared = await ctx.keyPUT(request(`https://d.local/api/keys/${createdBody.id}`, "PUT", { providerConnectionIds: [] }), { params: Promise.resolve({ id: createdBody.id }) });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).key.providerConnectionIds).toEqual([]);
  });

  it("rejects invalid scope transactionally without creating or mutating a key", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const before = await ctx.getApiKeys();
    expect((await ctx.keysPOST(request("https://d.local/api/keys", "POST", { name: "Bad", providerConnectionIds: ["missing"] }))).status).toBe(400);
    expect(await ctx.getApiKeys()).toEqual(before);
    const { id, key: secret } = await (await ctx.keysPOST(request("https://d.local/api/keys", "POST", { name: "Stable" }))).json();
    expect((await ctx.keyPUT(request(`https://d.local/api/keys/${id}`, "PUT", { name: "Changed", providerConnectionIds: ["missing"] }), { params: Promise.resolve({ id }) })).status).toBe(400);
    const unchanged = await ctx.getApiKeyById(id);
    expect(unchanged.name).toBe("Stable");
    expect(unchanged.key).toBe(secret);
  });

  it("blocks single connection deletion and provider-node bulk deletion that would broaden a scoped key", async () => {
    const ctx = await setup(); cleanup = ctx.cleanup;
    const { id } = await (await ctx.keysPOST(request("https://d.local/api/keys", "POST", { name: "Guarded", providerConnectionIds: [ctx.connection.id] }))).json();
    const single = await ctx.providerDelete(request(`https://d.local/api/providers/${ctx.connection.id}`, "DELETE"), { params: Promise.resolve({ id: ctx.connection.id }) });
    expect(single.status).toBe(409);
    expect((await single.json()).error).toContain("last scoped account");
    expect(await ctx.getApiKeyProviderConnectionIds(id)).toEqual([ctx.connection.id]);
    await expect(ctx.deleteProviderConnectionsByProvider("groq")).rejects.toMatchObject({ code: "API_KEY_SCOPE_WOULD_BROADEN" });

    const nodeConnection = await ctx.createProviderConnection({ provider: "node-1", authType: "apikey", name: "Node scoped", apiKey: "node-secret" });
    const nodeKey = await (await ctx.keysPOST(request("https://d.local/api/keys", "POST", { name: "Node guarded", providerConnectionIds: [nodeConnection.id] }))).json();
    const nodeBulk = await ctx.nodeDelete(request("https://d.local/api/provider-nodes/node-1", "DELETE"), { params: Promise.resolve({ id: "node-1" }) });
    expect(nodeBulk.status).toBe(409);
    expect((await nodeBulk.json()).error).toContain("last scoped account");
    expect(await ctx.getProviderNodeById("node-1")).not.toBeNull();
    expect(await ctx.getApiKeyProviderConnectionIds(nodeKey.id)).toEqual([nodeConnection.id]);
  });
});
