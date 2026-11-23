import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const previous = process.env.DATA_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-1423-"));
process.env.DATA_DIR = dir;
delete global._dbAdapter;
const db = await import("../../src/lib/db/index.js");
const managed = await import("../../src/lib/combos/comboManagement.js");
const createRoute = await import("../../src/app/api/combos/route.js");
const updateRoute = await import("../../src/app/api/combos/[id]/route.js");
const request = (body) => new Request("http://localhost/api/combos", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeAll(async () => { await db.initDb(); });
afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  if (previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

it("rejects cycles through REST and management while preserving valid chains", async () => {
  expect((await createRoute.POST(request({ name: "self", models: ["self"] }))).status).toBe(400);
  const a = await managed.createComboManaged({ name: "alpha", models: ["beta"] });
  const b = await managed.createComboManaged({ name: "beta", models: ["openai/model"] });
  const response = await updateRoute.PUT(request({ models: ["alpha"] }), { params: Promise.resolve({ id: b.id }) });
  expect(response.status).toBe(400);
  await expect(managed.updateComboManaged(b.id, { models: ["alpha"] })).rejects.toMatchObject({ status: 400 });
  expect((await db.getComboById(a.id)).models).toEqual(["beta"]);
  expect((await db.getComboById(b.id)).models).toEqual(["openai/model"]);
});

it("rejects a rename that redirects another graph into a cycle", async () => {
  const exact = await managed.createComboManaged({ name: "leaf", models: ["openai/model"] });
  await managed.createComboManaged({ name: "root", models: ["leaf"] });
  await managed.createComboManaged({ name: "Leaf", models: ["root"] });
  await expect(managed.updateComboManaged(exact.id, { name: "renamed" })).rejects.toMatchObject({ status: 400 });
  expect((await db.getComboById(exact.id)).name).toBe("leaf");
});
