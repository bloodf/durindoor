import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";

const state = vi.hoisted(() => ({ adapter: null }));
vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: async () => state.adapter,
  getAdapterSync: () => state.adapter,
}));
const { updateSettingsWithPasswordEpoch } = await import("../../src/lib/db/repos/settingsRepo.js");
let dir;
let file;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-epoch-flush-"));
  file = path.join(dir, "test.sqlite");
  state.adapter = await createSqlJsAdapter(file);
  state.adapter.exec("CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT)");
  state.adapter.run("INSERT INTO settings VALUES (1, ?)", [JSON.stringify({ password: "old", passwordSessionEpoch: "old-epoch" })]);
  state.adapter.flush();
});

afterEach(() => {
  state.adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("persists the rotated epoch immediately after a password change", async () => {
  await updateSettingsWithPasswordEpoch({ password: "new", passwordSessionEpoch: "new-epoch" }, "old-epoch");
  const reopened = await createSqlJsAdapter(file);
  try {
    expect(JSON.parse(reopened.get("SELECT data FROM settings WHERE id = 1").data)).toMatchObject({
      password: "new", passwordSessionEpoch: "new-epoch",
    });
  } finally {
    reopened.close();
  }
});
