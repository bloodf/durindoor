import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const previous = process.env.DATA_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-4584-"));
process.env.DATA_DIR = dir;
delete global._dbAdapter;
const db = await import("../../src/lib/db/index.js");
const { createComboManaged, updateComboManaged } = await import("../../src/lib/combos/comboManagement.js");

beforeAll(async () => {
  await db.initDb();
});
afterAll(() => {
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  if (previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

const catalogRow = { fullModel: "ag/gemini-3.8-flash", provider: "ag", model: "other" };

describe("decolua/9router#4584 - combo model identifiers are normalized at the management boundary", () => {
  it("stores catalog row objects as provider/model strings on create", async () => {
    const combo = await createComboManaged({
      name: "Create4584",
      models: [catalogRow, { provider: "cx", model: "gpt-6-sol" }, "ag/claude-sonnet-4-6"],
    });
    expect((await db.getComboById(combo.id)).models)
      .toEqual(["ag/gemini-3.8-flash", "cx/gpt-6-sol", "ag/claude-sonnet-4-6"]);
  });

  it("normalizes models and their weighted members together on update", async () => {
    const combo = await createComboManaged({ name: "Update4584", models: ["provider/old"] });
    await updateComboManaged(combo.id, {
      models: [catalogRow, "provider/old"],
      members: [{ id: catalogRow, weight: 3 }, { id: "provider/old", weight: 1 }],
    });
    const stored = await db.getComboById(combo.id);
    expect(stored.models).toEqual(["ag/gemini-3.8-flash", "provider/old"]);
    expect(stored.members).toEqual([{ id: "ag/gemini-3.8-flash", weight: 3 }, { id: "provider/old", weight: 1 }]);
  });

  it.each([
    ["an unroutable object", [{ name: "unroutable" }]],
    ["an empty string", ["", "cx/gpt-6-sol"]],
    ["a blank fullModel", [{ fullModel: "  " }]],
    ["a half-filled pair", [{ provider: "cx", model: "" }]],
    ["a non-string entry", [7]],
    ["a null entry", [null]],
  ])("rejects %s on create and update without touching stored rows", async (_label, models) => {
    const name = `Reject4584-${Math.random().toString(36).slice(2, 8)}`;
    await expect(createComboManaged({ name, models })).rejects.toMatchObject({ status: 400 });
    expect(await db.getComboByName(name)).toBeNull();
    const combo = await createComboManaged({ name, models: ["provider/model"] });
    await expect(updateComboManaged(combo.id, { models })).rejects.toMatchObject({ status: 400 });
    expect((await db.getComboById(combo.id)).models).toEqual(["provider/model"]);
  });

  it("keeps structured combo references as objects", async () => {
    await createComboManaged({ name: "Leaf4584", models: ["provider/model"] });
    const reference = { kind: "combo-ref", model: "Leaf4584" };
    const combo = await createComboManaged({ name: "Parent4584", models: [reference] });
    expect((await db.getComboById(combo.id)).models).toEqual([reference]);
  });
});
