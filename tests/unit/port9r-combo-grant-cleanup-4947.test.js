import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// Real temporary SQLite and the real repositories.
let tempDir;
let originalDataDir;
let db;

const adapter = async () => (await import("@/lib/db/driver.js")).getAdapter();
const newCombo = (name) => db.createCombo({ name, models: ["openai/model-a"] });
const newKey = (allowedCombos) => db.createApiKey("grant-test", "machine-test", allowedCombos);
const grants = async (id) => (await db.getApiKeys()).find((key) => key.id === id).allowedCombos;

beforeEach(async () => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-combo-grant-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("upstream #4947: deleting a combo revokes its API-key grants", () => {
  it("removes only the deleted name and keeps the other grants", async () => {
    const doomed = await newCombo("Main");
    await newCombo("other");
    const key = await newKey(["Main", "other"]);

    expect(await db.deleteCombo(doomed.id)).toBe(true);

    expect(await grants(key.id)).toEqual(["other"]);
  });

  it("never turns a restricted key into an all-combos key, and a recreated name stays denied", async () => {
    const doomed = await newCombo("Main");
    const key = await newKey(["Main"]);

    await db.deleteCombo(doomed.id);
    await newCombo("Main");

    const allowed = await grants(key.id);
    // An empty list means "all combos" here, so a non-matching marker stays.
    expect(allowed).toEqual(["(deleted combo)"]);
    expect(allowed).not.toContain("Main");
  });

  it("matches names exactly, as the request gate does", async () => {
    const lower = await newCombo("main");
    await newCombo("Main");
    const key = await newKey(["Main"]);

    await db.deleteCombo(lower.id);

    expect(await grants(key.id)).toEqual(["Main"]);
  });

  it("leaves unrestricted and unrelated keys untouched", async () => {
    const doomed = await newCombo("Main");
    const open = await newKey([]);
    const unrelated = await newKey(["other"]);

    await db.deleteCombo(doomed.id);

    expect(await grants(open.id)).toEqual([]);
    expect(await grants(unrelated.id)).toEqual(["other"]);
  });

  it("rolls the deletion back when a grant update fails", async () => {
    const doomed = await newCombo("Main");
    const key = await newKey(["Main"]);
    (await adapter()).exec(`CREATE TRIGGER fail_grant_cleanup BEFORE UPDATE OF allowedCombos ON apiKeys
      BEGIN SELECT RAISE(ABORT, 'test cleanup failure'); END;`);

    await expect(db.deleteCombo(doomed.id)).rejects.toThrow("test cleanup failure");

    expect(await db.getComboById(doomed.id)).not.toBeNull();
    expect(await grants(key.id)).toEqual(["Main"]);
  });

  it("returns false and changes nothing for a missing combo", async () => {
    const key = await newKey(["Main"]);

    expect(await db.deleteCombo("missing")).toBe(false);
    expect(await grants(key.id)).toEqual(["Main"]);
  });
});
