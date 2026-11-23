import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const previous = process.env.DATA_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-1434-"));
process.env.DATA_DIR = dir;
delete global._dbAdapter;
const db = await import("../../src/lib/db/index.js");
const { createComboManaged, updateComboManaged } = await import("../../src/lib/combos/comboManagement.js");
let adapter;
beforeAll(async () => {
  await db.initDb();
  adapter = await import("../../src/lib/db/driver.js").then((m) => m.getAdapter());
});
afterAll(() => {
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  if (previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("combo graph validation", () => {
  it("rejects structured references on create and update and preserves stored rows", async () => {
    const a = await createComboManaged({ name: "Alpha1434", models: ["Beta1434"] });
    await expect(createComboManaged({ name: "Beta1434", models: [{ kind: "combo-ref", model: "Alpha1434" }] })).rejects.toMatchObject({ status: 400 });
    const b = await createComboManaged({ name: "Beta1434", models: ["provider/model"] });
    await expect(updateComboManaged(b.id, { models: [{ kind: "combo-ref", comboId: a.id }] })).rejects.toMatchObject({ status: 400 });
    expect((await db.getComboById(b.id)).models).toEqual(["provider/model"]);
  });
  it("rejects one of two competing writes that would close a cycle", async () => {
    const a = await db.createCombo({ name: "ConcurrentA1434", models: ["provider/model"] });
    const b = await db.createCombo({ name: "ConcurrentB1434", models: ["provider/model"] });
    const outcomes = await Promise.allSettled([
      updateComboManaged(a.id, { models: [b.name] }),
      updateComboManaged(b.id, { models: [a.name] })
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")[0].reason).toMatchObject({ status: 400 });
  });
  it("rejects rename cycles and reachable existing cycles without blocking unrelated writes", async () => {
    await db.createCombo({ name: "RenameTarget1434", models: ["Future1434"] });
    const candidate = await db.createCombo({ name: "Old1434", models: ["RenameTarget1434"] });
    await expect(updateComboManaged(candidate.id, { name: "Future1434" })).rejects.toMatchObject({ status: 400 });
    const x = await db.createCombo({ name: "ExistingX1434", models: ["provider/model"] });
    const y = await db.createCombo({ name: "ExistingY1434", models: ["ExistingX1434"] });
    adapter.run("UPDATE combos SET models = ?, members = ? WHERE id = ?", [JSON.stringify(["ExistingY1434"]), JSON.stringify([{ id: "ExistingY1434", weight: 1 }]), x.id]);
    await expect(createComboManaged({ name: "Touches1434", models: [y.name] })).rejects.toMatchObject({ status: 400 });
    await expect(createComboManaged({ name: "Independent1434", models: ["provider/model"] })).resolves.toMatchObject({ name: "Independent1434" });
  });
});
