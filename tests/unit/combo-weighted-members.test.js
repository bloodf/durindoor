// Unit 1/2/3/4 of #748 (port of decolua/9router#3768, theme units only):
// weighted combo member persistence + weighted dispatch selection.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRotatedModels, getWeightedModels, handleComboChat } from "../../open-sse/services/combo.js";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-combo-weights-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createCombo, updateCombo, getComboById, getCombos, exportDb, importDb, importSelectiveDb, ComboMemberError } = await import("@/lib/localDb");
  return {
    createCombo,
    updateCombo,
    getComboById,
    getCombos,
    exportDb,
    importDb,
    importSelectiveDb,
    ComboMemberError,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("weighted combo member persistence", () => {
  let cleanup = () => {};

  afterEach(() => {
    vi.resetModules();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("round-trips non-uniform weights", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const created = await ctx.createCombo({
      name: "weighted-combo",
      models: ["p/a", "p/b", "p/c"],
      members: [{ id: "p/a", weight: 5 }, { id: "p/b", weight: 1 }, { id: "p/c", weight: 0.5 }],
    });
    expect(created.members).toEqual([{ id: "p/a", weight: 5 }, { id: "p/b", weight: 1 }, { id: "p/c", weight: 0.5 }]);

    const fetched = await ctx.getComboById(created.id);
    expect(fetched.members).toEqual([{ id: "p/a", weight: 5 }, { id: "p/b", weight: 1 }, { id: "p/c", weight: 0.5 }]);
  });

  it("default weight (no members field) is 1 and preserves existing behavior", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const created = await ctx.createCombo({ name: "legacy-combo", models: ["p/a", "p/b"] });
    expect(created.members).toEqual([{ id: "p/a", weight: 1 }, { id: "p/b", weight: 1 }]);
  });

  it("a models-only patch preserves prior weights for surviving members", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const created = await ctx.createCombo({
      name: "patch-combo",
      models: ["p/a", "p/b"],
      members: [{ id: "p/a", weight: 3 }, { id: "p/b", weight: 1 }],
    });
    const updated = await ctx.updateCombo(created.id, { models: ["p/b", "p/a", "p/c"] });
    expect(updated.members).toEqual([{ id: "p/b", weight: 1 }, { id: "p/a", weight: 3 }, { id: "p/c", weight: 1 }]);
  });

  it("preserves duplicate model occurrences and their weights through read and models-only updates", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const created = await ctx.createCombo({
      name: "duplicate-models",
      models: ["p/a", "p/a", "p/b"],
      members: [{ id: "p/a", weight: 2 }, { id: "p/b", weight: 4 }, { id: "p/a", weight: 3 }],
    });
    expect(created.members).toEqual([
      { id: "p/a", weight: 2 },
      { id: "p/a", weight: 3 },
      { id: "p/b", weight: 4 },
    ]);
    expect((await ctx.getComboById(created.id)).members).toEqual(created.members);

    const updated = await ctx.updateCombo(created.id, { models: ["p/a", "p/b", "p/a", "p/a"] });
    expect(updated.members).toEqual([
      { id: "p/a", weight: 2 },
      { id: "p/b", weight: 4 },
      { id: "p/a", weight: 3 },
      { id: "p/a", weight: 1 },
    ]);
    expect((await ctx.getComboById(created.id)).members).toEqual(updated.members);
  });

  it("rejects non-array models patches without changing the stored combo", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const created = await ctx.createCombo({
      name: "unchanged-after-invalid-models",
      models: ["p/a", "p/a"],
      members: [{ id: "p/a", weight: 2 }, { id: "p/a", weight: 5 }],
    });

    await expect(ctx.updateCombo(created.id, { name: "must-not-stick", models: "p/b" }))
      .rejects.toThrow(ctx.ComboMemberError);
    expect(await ctx.getComboById(created.id)).toEqual(created);

    const renamed = await ctx.updateCombo(created.id, { name: "models-omitted" });
    expect(renamed.models).toEqual(created.models);
    expect(renamed.members).toEqual(created.members);
  });

  it("rejects non-array models on create", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await expect(ctx.createCombo({ name: "invalid-models", models: "p/a" }))
      .rejects.toThrow(ctx.ComboMemberError);
    expect(await ctx.getCombos()).toEqual([]);
  });

  it("rejects zero, negative, and NaN weights", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await expect(ctx.createCombo({
      name: "bad-zero", models: ["p/a"], members: [{ id: "p/a", weight: 0 }],
    })).rejects.toThrow(ctx.ComboMemberError);
    await expect(ctx.createCombo({
      name: "bad-negative", models: ["p/a"], members: [{ id: "p/a", weight: -2 }],
    })).rejects.toThrow(ctx.ComboMemberError);
    await expect(ctx.createCombo({
      name: "bad-nan", models: ["p/a"], members: [{ id: "p/a", weight: Number.NaN }],
    })).rejects.toThrow(ctx.ComboMemberError);
  });

  it("rejects a members list that does not match the models list", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await expect(ctx.createCombo({
      name: "mismatch", models: ["p/a", "p/b"], members: [{ id: "p/a", weight: 1 }],
    })).rejects.toThrow(ctx.ComboMemberError);
  });

  it("full backup round-trips weights and canonicalizes legacy members", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const weighted = await ctx.createCombo({
      name: "backup-weighted",
      models: ["p/a", "p/b"],
      members: [{ id: "p/a", weight: 4 }, { id: "p/b", weight: 0.25 }],
    });
    const snapshot = await ctx.exportDb();
    snapshot.combos.push({ id: "legacy", name: "backup-legacy", models: ["p/c", "p/c", "p/d"], members: null });
    await ctx.importDb(snapshot);
    expect((await ctx.getComboById(weighted.id)).members).toEqual([{ id: "p/a", weight: 4 }, { id: "p/b", weight: 0.25 }]);
    expect((await ctx.getComboById("legacy")).members).toEqual([{ id: "p/c", weight: 1 }, { id: "p/c", weight: 1 }, { id: "p/d", weight: 1 }]);
  });

  it("full import rejects malformed members before destructive writes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const kept = await ctx.createCombo({ name: "kept-before-invalid-import", models: ["p/kept"] });
    const invalid = await ctx.exportDb();
    invalid.combos = [{ id: "invalid", name: "invalid", models: ["p/a"], members: [{ id: "p/b", weight: 0 }] }];
    await expect(ctx.importDb(invalid)).rejects.toThrow(ctx.ComboMemberError);
    expect((await ctx.getCombos()).map((combo) => combo.id)).toEqual([kept.id]);
  });

  it("returns the invariant persisted by an update", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const created = await ctx.createCombo({ name: "invariant-combo", models: ["p/a"] });
    const invariant = { allowedProviders: ["p"] };
    const updated = await ctx.updateCombo(created.id, { invariant });
    const fetched = await ctx.getComboById(created.id);
    expect(updated.invariant).toEqual(fetched.invariant);
    expect(updated.invariant.allowedProviders).toEqual(invariant.allowedProviders);
    expect(updated.invariant.allowedModelFamilies).toEqual([]);
  });

  it("rejects provider-qualified string models before create writes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await expect(ctx.createCombo({
      name: "provider-guard",
      models: ["openai/gpt-5"],
      invariant: { allowedProviders: ["anthropic"] },
    })).rejects.toThrow(/openai\/gpt-5.*violates its invariant/);
    expect(await ctx.getCombos()).toEqual([]);
  });

  it("rejects a string model family violation before update writes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const created = await ctx.createCombo({ name: "family-guard", models: ["anthropic/claude-sonnet-4.6"] });
    await expect(ctx.updateCombo(created.id, {
      models: ["openai/gpt-5"],
      invariant: { allowedModelFamilies: ["claude"] },
    })).rejects.toThrow(/openai\/gpt-5.*violates its invariant/);
    expect(await ctx.getComboById(created.id)).toMatchObject({
      models: ["anthropic/claude-sonnet-4.6"],
      invariant: null,
    });
  });

  it("accepts a valid qualified string and leaves a bare nested combo reference deferred", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const direct = await ctx.createCombo({
      name: "valid-guard",
      models: ["anthropic/claude-sonnet-4.6"],
      invariant: { allowedProviders: ["anthropic"], allowedModelFamilies: ["claude"] },
    });
    const nested = await ctx.createCombo({
      name: "nested-guard",
      models: [direct.name],
      invariant: { allowedProviders: ["provider-not-known-until-expansion"] },
    });
    expect(direct.models).toEqual(["anthropic/claude-sonnet-4.6"]);
    expect(nested.models).toEqual([direct.name]);
  });

  it("rejects a selective import string violation before any combo writes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const kept = await ctx.createCombo({ name: "kept-selective", models: ["openai/gpt-5"] });
    const bundle = {
      format: "durindoor-selective-transfer",
      version: 1,
      providerConnections: [],
      combos: [{
        id: "violating-string",
        name: "violating-string",
        kind: "weighted",
        models: ["openai/gpt-5"],
        invariant: { allowedProviders: ["openai"], allowedModelFamilies: ["claude"] },
      }],
    };
    await expect(ctx.importSelectiveDb(bundle, { providers: [], combos: ["violating-string"] }))
      .rejects.toThrow(/openai\/gpt-5.*violates its invariant/);
    expect((await ctx.getCombos()).map(({ id }) => id)).toEqual([kept.id]);
  });
});

describe("getWeightedModels deterministic selection", () => {
  it("higher weight deterministically wins the first choice for equal random draws", () => {
    const models = ["p/heavy", "p/light1", "p/light2"];
    const members = [{ id: "p/heavy", weight: 1000 }, { id: "p/light1", weight: 1 }, { id: "p/light2", weight: 1 }];
    expect(getWeightedModels(models, members, () => 0.5)[0]).toBe("p/heavy");
  });

  it("every member remains present so fallback eligibility is unchanged", () => {
    const models = ["p/a", "p/b", "p/c"];
    const members = [{ id: "p/a", weight: 10 }, { id: "p/b", weight: 1 }, { id: "p/c", weight: 1 }];
    const result = getWeightedModels(models, members);
    expect(result.slice().sort()).toEqual(models.slice().sort());
  });

  it("falls back to uniform weight 1 for a model missing from members", () => {
    const models = ["p/known", "p/unknown"];
    const members = [{ id: "p/known", weight: 1 }];
    // Deterministic: mock Math.random to always return the same value so both
    // candidates get the same key when both default to weight 1.
    const result = getWeightedModels(models, members, () => 0.5);
    expect(result.slice().sort()).toEqual(models.slice().sort());
  });

  it("getRotatedModels dispatches to the weighted path by strategy name", () => {
    const models = ["p/a", "p/b"];
    const members = [{ id: "p/a", weight: 1 }, { id: "p/b", weight: 1 }];
    const rotated = getRotatedModels(models, "combo", "weighted", 1, null, members);
    expect(rotated.slice().sort()).toEqual(models.slice().sort());
  });
});

describe("handleComboChat weighted strategy — terminal 400 unaffected", () => {
  const log = { info() {}, warn() {}, debug() {}, error() {} };

  it("a non-fallback error status still returns immediately without trying the next model", async () => {
    const attempted = [];
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      comboMembers: [{ id: "p/a", weight: 1 }, { id: "p/b", weight: 100 }],
      comboStrategy: "weighted",
      handleSingleModel: async (_body, model) => {
        attempted.push(model);
        return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
      },
      log,
    });
    expect(response.status).toBe(400);
    expect(attempted).toHaveLength(1);
  });
});
