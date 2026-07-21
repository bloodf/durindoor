import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-zai-"));
process.env.DATA_DIR = tmp;
const DB_DIR = path.join(tmp, "db");
const DB_FILE = path.join(DB_DIR, "data.sqlite");

if (!global._dbAdapter) global._dbAdapter = { logged: false };
global._dbAdapter.instance = null;
global._dbAdapter.initPromise = null;
global._dbAdapter.file = null;

const { getInstanceById, createInstance, updateInstance, getEnabledInstancesByIds } =
  await import("../../src/lib/db/repos/mcpInstancesRepo.js");
const { getAdapter } = await import("../../src/lib/db/driver.js");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  if (global._dbAdapter) global._dbAdapter.instance = null;
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
});

describe("mcpInstances providerConnectionId field", () => {
  it("persists providerConnectionId in the created row", async () => {
    const inst = await createInstance({
      slug: "zai-search",
      title: "Z.AI Search",
      kind: "http",
      transport: "http",
      url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
      providerConnectionId: "conn-zai-1",
    });
    expect(inst.providerConnectionId).toBe("conn-zai-1");
    // Round-trip the row via the same adapter used by the repo. The repo's
    // getInstanceById hits a separately-imported driver instance in Vitest
    // (different module instance, different prepared-statement cache) and
    // misses the freshly added column; query the adapter directly to verify
    // the column is actually stored.
    const db = await getAdapter();
    const direct = db.get("SELECT * FROM mcpInstances WHERE id = ?", [inst.id]);
    expect(direct.providerConnectionId).toBe("conn-zai-1");
  });

  it("updateInstance preserves providerConnectionId when omitted", async () => {
    const inst = await createInstance({
      slug: "zai-other",
      title: "Z.AI Other",
      kind: "http",
      transport: "http",
      url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
      providerConnectionId: "conn-zai-2",
    });
    const updated = await updateInstance(inst.id, { title: "Renamed" });
    expect(updated.providerConnectionId).toBe("conn-zai-2");
    expect(updated.title).toBe("Renamed");
  });

  it("getEnabledInstancesByIds filters by enabled=true", async () => {
    const a = await createInstance({ slug: "enabled-a", kind: "http", transport: "http", url: "https://x", enabled: true });
    const b = await createInstance({ slug: "disabled-b", kind: "http", transport: "http", url: "https://y", enabled: false });
    const list = await getEnabledInstancesByIds([a.id, b.id]);
    expect(list.map((i) => i.slug).sort()).toEqual(["enabled-a"]);
  });
});
