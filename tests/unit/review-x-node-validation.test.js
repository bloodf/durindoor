import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// Create route, update route and nodesRepo must reject the same invalid payloads
// with the same message; valid payloads still save through all three.

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) },
}));
vi.mock("@/dashboardGuard", () => ({ canManageAccessConfig: async () => true }));

const originalDataDir = process.env.DATA_DIR;
let dir, db, POST, PUT;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-node-validation-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ POST } = await import("@/app/api/provider-nodes/route.js"));
  ({ PUT } = await import("@/app/api/provider-nodes/[id]/route.js"));
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

const good = { name: "Node", prefix: "node", apiType: "chat", baseUrl: "https://provider.example.test/v1" };
const json = (method, body) => new Request("http://localhost/api/provider-nodes", {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

async function seed(id, extra = {}) {
  return db.createProviderNode({ id, type: "openai-compatible", ...good, prefix: id, ...extra });
}
async function viaCreateRoute(body) {
  const response = await POST(json("POST", { type: "openai-compatible", ...body }));
  return { status: response.status, error: (await response.json()).error };
}
async function viaUpdateRoute(body) {
  const id = `upd-${Math.random().toString(36).slice(2, 8)}`;
  await seed(id);
  const response = await PUT(json("PUT", body), { params: Promise.resolve({ id }) });
  return { status: response.status, error: (await response.json()).error };
}
async function viaRepo(body, op) {
  try {
    if (op === "create") await db.createProviderNode({ id: `repo-c-${Math.random().toString(36).slice(2, 8)}`, type: "openai-compatible", ...body });
    else {
      const id = `repo-u-${Math.random().toString(36).slice(2, 8)}`;
      await seed(id);
      await db.updateProviderNode(id, body);
    }
    return { status: 200, error: undefined };
  } catch (error) {
    return { status: error.status, error: error.message };
  }
}

describe("provider-node validation is shared by create, update and the repo", () => {
  it.each([
    ["a non-string base URL", { baseUrl: 42 }, "Invalid base URL"],
    ["a blocked metadata base URL", { baseUrl: "http://169.254.169.254/latest/meta-data" }, "Invalid or blocked base URL"],
    ["a file: base URL", { baseUrl: "file:///etc/passwd" }, "Invalid or blocked base URL"],
    ["a base URL with credentials", { baseUrl: "https://user:pass@example.com/v1" }, "Invalid or blocked base URL"],
    ["an unsafe icon URL", { iconUrl: "javascript:alert(1)" }, "Invalid icon URL"],
    ["an unknown apiType", { apiType: "bogus" }, "Invalid OpenAI compatible API type"],
    ["a blank name", { name: "   " }, "Name is required"],
  ])("rejects %s identically on create, update and repo", async (_label, patch, message) => {
    const body = { ...good, ...patch };
    const results = [
      await viaCreateRoute(body),
      await viaUpdateRoute(body),
      await viaRepo(body, "create"),
      await viaRepo(patch, "update"),
    ];
    for (const result of results) expect(result).toEqual({ status: 400, error: message });
  });

  it("requires a base URL on update and on the repo with the same message", async () => {
    for (const baseUrl of [undefined, "", "   "]) {
      const body = { ...good, baseUrl };
      expect(await viaUpdateRoute(body)).toEqual({ status: 400, error: "Base URL is required" });
      if (baseUrl !== undefined) expect(await viaRepo({ baseUrl }, "update")).toEqual({ status: 400, error: "Base URL is required" });
    }
  });

  it("requires name and prefix on both routes", async () => {
    for (const run of [viaCreateRoute, viaUpdateRoute]) {
      expect(await run({ ...good, name: undefined })).toEqual({ status: 400, error: "Name is required" });
      expect(await run({ ...good, prefix: " " })).toEqual({ status: 400, error: "Prefix is required" });
    }
  });

  it("still saves a valid payload through the routes and the repo", async () => {
    const created = await POST(json("POST", { type: "openai-compatible", ...good, prefix: "saved-route", iconUrl: "https://icons.example/logo.png" }));
    expect(created.status).toBe(201);
    const { node } = await created.json();
    expect(node).toMatchObject({ name: "Node", prefix: "saved-route", baseUrl: good.baseUrl, iconUrl: "https://icons.example/logo.png" });

    const updated = await PUT(json("PUT", { ...good, name: "Renamed", prefix: "saved-route", apiType: "responses" }), { params: Promise.resolve({ id: node.id }) });
    expect(updated.status).toBe(200);
    expect((await updated.json()).node).toMatchObject({ name: "Renamed", apiType: "responses" });

    await seed("saved-repo");
    expect(await db.updateProviderNode("saved-repo", { name: "Patched" })).toMatchObject({ name: "Patched", baseUrl: good.baseUrl });
    expect((await db.getProviderNodeById("saved-repo")).name).toBe("Patched");
  });

  it("normalises pasted endpoint suffixes the same way on every path", async () => {
    const created = await POST(json("POST", { type: "anthropic-compatible", name: "A", prefix: "anth-route", baseUrl: "https://anthropic.example.test/v1/messages" }));
    expect((await created.json()).node.baseUrl).toBe("https://anthropic.example.test/v1");

    await db.createProviderNode({ id: "anth-repo", type: "anthropic-compatible", name: "A", prefix: "anth-repo", baseUrl: "https://anthropic.example.test/v1/messages/" });
    expect((await db.getProviderNodeById("anth-repo")).baseUrl).toBe("https://anthropic.example.test/v1");
    const patched = await db.updateProviderNode("anth-repo", { baseUrl: "https://other.example.test/v1/messages" });
    expect(patched.baseUrl).toBe("https://other.example.test/v1");
  });

  it("does not persist a node the repo rejects", async () => {
    await expect(db.createProviderNode({ id: "bad-repo", type: "openai-compatible", ...good, baseUrl: "file:///etc/passwd" })).rejects.toThrow("Invalid or blocked base URL");
    expect(await db.getProviderNodeById("bad-repo")).toBeNull();
  });
});
