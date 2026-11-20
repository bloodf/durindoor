import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { getRotatedModels, handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const models = ["p/a", "p/b", "p/c"];
const members = [{ id: "p/a", weight: 5 }, { id: "p/b", weight: 3 }, { id: "p/c", weight: 2 }];
afterEach(() => resetComboRotation());

it("uses a smooth deterministic cycle and retains legacy equal rotation", () => {
  const heads = Array.from({ length: 10 }, () => getRotatedModels(models, "smooth", "round-robin", 1, null, members)[0]);
  expect(heads).toEqual(["p/a", "p/b", "p/c", "p/a", "p/a", "p/b", "p/a", "p/c", "p/b", "p/a"]);
  expect(Array.from({ length: 4 }, () => getRotatedModels(models, "legacy", "round-robin")[0])).toEqual(["p/a", "p/b", "p/c", "p/a"]);
});

it("keeps zero weights last, resets on edits, and defaults invalid weights", () => {
  const weights = [{ id: "p/a", weight: 2 }, { id: "p/b", weight: 0 }, { id: "p/c", weight: 1 }];
  for (let i = 0; i < 6; i++) expect(getRotatedModels(models, "zero", "round-robin", 1, null, weights).at(-1)).toBe("p/b");
  expect(getRotatedModels(models, "zero", "round-robin", 1, null, members)[0]).toBe("p/a");
  expect(getRotatedModels(models, "invalid", "round-robin", 1, null, [{ id: "p/a", weight: NaN }])).toEqual(models);
});

it("persists zero fallback weights and preserves them through edits", async () => {
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-rr-"));
  try {
    process.env.DATA_DIR = dir;
    vi.resetModules();
    const db = await import("@/lib/localDb");
    const saved = await db.createCombo({ name: "rr-zero", models: models.slice(0, 2), members: [{ id: "p/a", weight: 2 }, { id: "p/b", weight: 0 }] });
    await expect(db.updateCombo(saved.id, { models: ["p/b"] })).rejects.toThrow();
    await db.updateCombo(saved.id, { models: ["p/b", "p/a", "p/c"] });
    expect((await db.getComboById(saved.id)).members).toEqual([{ id: "p/b", weight: 0 }, { id: "p/a", weight: 2 }, { id: "p/c", weight: 1 }]);
  } finally {
    if (original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = original;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.resetModules();
  }
});

it("routes a non-chat search body and retries a zero-weight fallback", async () => {
  const calls = [];
  const response = await handleComboChat({ body: { query: "example" }, models: models.slice(0, 2), comboName: "search-rr", comboStrategy: "round-robin", checkEmptyBody: false, comboMembers: [{ id: "p/a", weight: 2 }, { id: "p/b", weight: 0 }], log: { info() {}, warn() {}, error() {}, debug() {} }, handleSingleModel: async (_body, model) => { calls.push(model); return new Response("{}", { status: model === "p/a" ? 503 : 200 }); } });
  expect(response.status).toBe(200);
  expect(calls).toEqual(["p/a", "p/b"]);
});
