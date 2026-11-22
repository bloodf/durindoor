import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-cycle-"));
process.env.DATA_DIR = tempDir;
delete global._dbAdapter;
const db = await import("../../src/lib/db/index.js");
const { createComboManaged, updateComboManaged } = await import("../../src/lib/combos/comboManagement.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");
let adapter;

beforeAll(async () => {
  await db.initDb();
  adapter = await import("../../src/lib/db/driver.js").then((m) => m.getAdapter());
});
afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("combo cycle protection", () => {
  it("rejects self references and cycles closed by create, update, or rename with 400", async () => {
    await expect(createComboManaged({ name: "Self", models: ["self"] })).rejects.toMatchObject({ status: 400 });
    const a = await createComboManaged({ name: "CycleA", models: ["CycleB"] });
    await expect(createComboManaged({ name: "CycleB", models: ["cyclea"] })).rejects.toMatchObject({ status: 400 });
    const b = await createComboManaged({ name: "CycleB", models: ["openai/gpt-4o"] });
    await expect(updateComboManaged(b.id, { models: ["CycleA"] })).rejects.toMatchObject({ status: 400 });
    const c = await createComboManaged({ name: "Other", models: ["CycleA"] });
    await expect(updateComboManaged(c.id, { name: "CycleB2", models: ["CycleB2"] })).rejects.toMatchObject({ status: 400 });
    expect((await db.getComboById(a.id)).models).toEqual(["CycleB"]);
    expect((await db.getComboById(b.id)).models).toEqual(["openai/gpt-4o"]);
  });

  it("bounds dispatch of a legacy cycle", async () => {
    const a = await db.createCombo({ name: "LegacyA", models: ["LegacyB"] });
    await db.createCombo({ name: "LegacyB", models: ["openai/gpt-4o"] });
    adapter.run("UPDATE combos SET models = ?, members = ? WHERE name = ?", [JSON.stringify(["LegacyA"]), JSON.stringify([{ id: "LegacyA", weight: 1 }]), "LegacyB"]);
    await db.updateSettings({ requireApiKey: false });
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: a.name, messages: [{ role: "user", content: "hello" }] }),
    }));
    expect(response.status).toBe(400);
  }, 15000);
});
