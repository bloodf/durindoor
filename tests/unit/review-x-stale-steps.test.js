import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { findStaleSteps } from "../../src/lib/modelAutoSync/staleComboSteps.js";
import { findPrunedReferences } from "../../src/lib/modelAutoSync/catalog.js";

const providers = [{ providerId: "openai", aliases: ["openai"], ids: new Set(["model"]), customIds: new Set(["custom"]) }];

it("recognizes catalog and custom models with request suffixes", () => {
  const models = ["openai/model(high)", "openai/model[1m]", "openai/model-1m(high)", "openai/custom[1m](high)", "openai/missing(high)", "openai/model(opaque)"];
  expect(findStaleSteps({ models }, providers).map((step) => step.model)).toEqual(models.slice(4));
  expect(findPrunedReferences({ providers, combos: [{ name: "test", models }], modelAliases: { good: models[0], bad: models[4] } }))
    .toEqual({ combos: { test: models.slice(4) }, aliases: { bad: models[4] } });
});

let tempDir;
let originalDataDir;
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

it("restores duplicate pruned steps with their individual weights", async () => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-stale-review-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  const db = await import("../../src/lib/db/index.js");
  const { pruneComboSteps, restorePrunedSteps } = await import("../../src/lib/db/repos/combosRepo.js");
  await db.initDb();
  const members = [{ id: "openai/keep", weight: 1 }, { id: "openai/gone", weight: 2 }, { id: "openai/gone", weight: 5 }];
  const combo = await db.createCombo({ name: "duplicates", models: members.map((member) => member.id), members });
  await pruneComboSteps(combo.id, [1, 2].map((step) => ({ step, model: "openai/gone", provider: "openai" })));
  const result = await restorePrunedSteps(combo.id);
  expect(result.restored).toHaveLength(2);
  expect((await db.getComboById(combo.id)).members).toEqual(members);
});
