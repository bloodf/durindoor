import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-combo-case-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createCombo } = await import("@/lib/localDb");
  const { getComboModels, getModelInfo } = await import("@/sse/services/model.js");
  return {
    createCombo,
    getComboModels,
    getModelInfo,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("case-insensitive combo model resolution", () => {
  let cleanup = () => {};

  afterEach(() => {
    vi.resetModules();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("resolves a mixed-case combo name to its canonical stored name", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    await ctx.createCombo({ name: "CodeX-High", models: ["openai/GPT-5"] });

    await expect(ctx.getModelInfo("codex-high")).resolves.toEqual({
      provider: null,
      model: "CodeX-High",
    });
    await expect(ctx.getComboModels("CODEX-HIGH")).resolves.toEqual(["openai/GPT-5"]);
  });

  it("keeps similarly cased non-combo provider model IDs unchanged", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await expect(ctx.getModelInfo("openai/GPT-5")).resolves.toEqual({
      provider: "openai",
      model: "GPT-5",
    });
    await expect(ctx.getComboModels("openai/GPT-5")).resolves.toBeNull();
  });
});
