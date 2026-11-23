import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import "../translator/registerAll.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const original = process.env.DATA_DIR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-no-log-"));
process.env.DATA_DIR = dir;
delete global._dbAdapter;
const db = await import("../../src/lib/db/index.js");
const { createComboManaged, updateComboManaged } = await import("../../src/lib/combos/comboManagement.js");

beforeAll(async () => { await db.initDb(); });
afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  if (original === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = original;
  fs.rmSync(dir, { recursive: true, force: true });
});

it("validates and persists the logging opt-out across create, reads and updates", async () => {
  await expect(createComboManaged({ name: "bad", noLog: "true" })).rejects.toMatchObject({ status: 400 });
  const combo = await createComboManaged({ name: "private", models: ["openai/model"], noLog: true });
  expect((await db.getComboById(combo.id)).noLog).toBe(true);
  expect((await db.getComboByName("private")).noLog).toBe(true);
  expect((await db.getCombos()).find((entry) => entry.id === combo.id).noLog).toBe(true);
  await expect(updateComboManaged(combo.id, { noLog: 1 })).rejects.toMatchObject({ status: 400 });
  const backup = await db.exportDb();
  expect(backup.combos.find((entry) => entry.id === combo.id).noLog).toBe(true);
  await db.importDb(backup);
  expect((await db.getComboById(combo.id)).noLog).toBe(true);
  const bundle = await db.exportSelectiveDb({ combos: [combo.id] });
  expect(bundle.combos[0].noLog).toBe(true);
  await db.importSelectiveDb(bundle, { combos: [combo.id] });
  expect((await db.getComboById(combo.id)).noLog).toBe(true);
  await updateComboManaged(combo.id, { name: "renamed" });
  expect((await db.getComboById(combo.id)).noLog).toBe(true);
  await updateComboManaged(combo.id, { noLog: false });
  expect((await db.getComboById(combo.id)).noLog).toBe(false);
});
