import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPricingForModel as resolveBuiltin } from "../../open-sse/providers/pricing.js";

describe("decolua/9router#4635 effort-annotated ids price at the base model rate", () => {
  it.each([
    ["codex", "gpt-5.6-sol", "(xhigh)"],
    ["openai", "gpt-5.6-sol", "(max)"],
    ["openai", "gpt-6-luna", "(minimal)"],
    ["openai", "gpt-6-luna", "(none)"],
    ["anthropic", "claude-sonnet-5-5", "(8192)"],
    [null, "gpt-6-luna", "(high)"],
  ])("builtin rate for %s/%s%s equals the base rate", (provider, model, suffix) => {
    const base = resolveBuiltin(provider, model);
    expect(base).not.toBeNull();
    expect(resolveBuiltin(provider, model + suffix)).toEqual(base);
  });

  it("keeps an unrecognized parenthesized value as part of the model id", () => {
    expect(resolveBuiltin("openai", "gpt-6-luna(preview)")).toBeNull();
  });

  describe("operator overrides", () => {
    const originalDataDir = process.env.DATA_DIR;
    let tempDir;
    let repo;

    beforeAll(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-pricing-suffix-"));
      process.env.DATA_DIR = tempDir;
      vi.resetModules();
      delete global._dbAdapter;
      repo = await import("../../src/lib/db/repos/pricingRepo.js");
    });

    afterAll(() => {
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
      delete global._dbAdapter;
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("applies a base-id override to the annotated id and records its origin", async () => {
      await repo.updatePricing({ codex: { "gpt-6-luna": { input: 9, output: 99 } } });
      const resolved = await repo.resolvePricingForModel("codex", "gpt-6-luna(xhigh)");
      expect(resolved.pricing).toMatchObject({ input: 9, output: 99 });
      expect(resolved.provenance).toMatchObject({ source: "override", model: "gpt-6-luna(xhigh)", overrideModel: "gpt-6-luna" });
    });

    it("prefers an override saved on the exact annotated id", async () => {
      await repo.updatePricing({ codex: { "gpt-6-sol": { input: 8 }, "gpt-6-sol(max)": { input: 1 } } });
      expect((await repo.getPricingForModel("codex", "gpt-6-sol(max)")).input).toBe(1);
      expect((await repo.getPricingForModel("codex", "gpt-6-sol(high)")).input).toBe(8);
    });
  });
});
