import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";

// Replace only adapter selection: repository SQL and transactions execute
// against the production SQLite adapter and a fresh disposable database.
// Never initialize the global driver or discover the host's DATA_DIR/PG URL.
const fixture = vi.hoisted(() => ({ adapter: null }));
vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: async () => {
    if (!fixture.adapter) throw new Error("finite settings fixture not initialized");
    return fixture.adapter;
  },
  getAdapterSync: () => {
    if (!fixture.adapter) throw new Error("finite settings fixture not initialized");
    return fixture.adapter;
  },
}));
const {
  getSettings,
  updateSettings,
  updateSettingsWithPasswordEpoch,
  PasswordEpochMismatchError,
} = await import("../../src/lib/db/repos/settingsRepo.js");

let tempDir;
const storedJson = () => fixture.adapter.get("SELECT data FROM settings WHERE id = 1").data;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-finite-settings-"));
  fixture.adapter = createBetterSqliteAdapter(path.join(tempDir, "fixture.sqlite"));
  fixture.adapter.exec("CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
});

afterEach(() => {
  fixture.adapter?.close();
  fixture.adapter = null;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("finite settings repository boundary (SQLite only, not global SQLi/PII proof)", () => {
  it("stores SQL-shaped JSON as literal data without changing unrelated rows or schema", async () => {
    fixture.adapter.exec("CREATE TABLE fixture_guard (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    fixture.adapter.run("INSERT INTO fixture_guard VALUES (?, ?)", [1, "untouched"]);
    await updateSettings({ theme: "dark", quotaTrackerState: { page: 3 } });
    const literal = "'); DROP TABLE settings; UPDATE fixture_guard SET value='changed'; --";
    await updateSettings({ oidcLoginLabel: literal });
    const returned = await getSettings();
    expect(returned.oidcLoginLabel).toBe(literal);
    expect(returned.theme).toBe("dark");
    expect(returned.quotaTrackerState.page).toBe(3);
    expect(JSON.parse(storedJson()).oidcLoginLabel).toBe(literal);
    expect(fixture.adapter.get("SELECT value FROM fixture_guard WHERE id = 1")).toEqual({ value: "untouched" });
    expect(fixture.adapter.get("SELECT COUNT(*) AS count FROM settings").count).toBe(1);
  });

  it("rejects a stale password epoch without overwriting the winning rotation", async () => {
    await updateSettings({ passwordSessionEpoch: "epoch-before", password: "synthetic-old-hash", theme: "dark" });
    await updateSettingsWithPasswordEpoch({ passwordSessionEpoch: "epoch-winner", password: "synthetic-winner-hash" }, "epoch-before");
    const winner = storedJson();
    await expect(updateSettingsWithPasswordEpoch({ passwordSessionEpoch: "epoch-loser", password: "synthetic-loser-hash", theme: "light" }, "epoch-before"))
      .rejects.toBeInstanceOf(PasswordEpochMismatchError);
    expect(storedJson()).toBe(winner);
    expect(await getSettings()).toMatchObject({ passwordSessionEpoch: "epoch-winner", password: "synthetic-winner-hash", theme: "dark" });
  });

  it("preserves explicit observability and retention choices across unrelated updates", async () => {
    await updateSettings({ enableObservability: false, dataRetentionEnabled: true, dataRetentionDays: 7 });
    const updated = await updateSettings({ theme: "light" });
    const choices = { enableObservability: false, dataRetentionEnabled: true, dataRetentionDays: 7 };
    expect(updated).toMatchObject(choices);
    expect(await getSettings()).toMatchObject(choices);
    expect(JSON.parse(storedJson())).toMatchObject({ ...choices, theme: "light" });
  });
});
