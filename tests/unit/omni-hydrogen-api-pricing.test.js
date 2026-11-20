import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import registry from "../../open-sse/providers/registry/gemini-interactions.js";
import { calculateCostBreakdown, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const provider = "gemini-interactions";
const model = "gemini-4-hydrogen";
const rates = { input: 1.5, output: 7.5, cached: 0.075, reasoning: 7.5 };
let directory, repo, originalDataDir;

beforeAll(async () => {
  originalDataDir = process.env.DATA_DIR;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "hydrogen-pricing-"));
  process.env.DATA_DIR = directory;
  vi.resetModules();
  await (await import("@/lib/db/index.js")).initDb();
  repo = await import("@/lib/db/repos/pricingRepo.js");
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Hydrogen Gemini Interactions pricing", () => {
  it("prices the registered API model with the standard paid rates", () => {
    expect(registry.category).toBe("apikey");
    expect(registry.transport.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(registry.models.some((entry) => entry.id === model)).toBe(true);
    expect(getPricingForModel(provider, model)).toEqual(rates);
    expect(getPricingForModel(provider, "unknown-unpriced-model")).toBeNull();
  });

  it("bills cached input and thinking once at either context size", () => {
    for (const prompt of [100_000, 300_000]) {
      const cost = calculateCostBreakdown({ prompt_tokens: prompt, cached_tokens: 20_000, completion_tokens: 10_000, reasoning_tokens: 4_000 }, rates);
      expect(cost.inputCost).toBeCloseTo((prompt - 20_000) * 1.5 / 1e6, 12);
      expect(cost.cachedCost).toBeCloseTo(20_000 * 0.075 / 1e6, 12);
      expect(cost.outputCost + cost.reasoningCost).toBeCloseTo(10_000 * 7.5 / 1e6, 12);
    }
    const additive = calculateCostBreakdown({ output_tokens: 10_000, reasoning_tokens: 4_000, reasoning_included_in_output: 0 }, rates);
    expect(additive.totalCost).toBeCloseTo(14_000 * 7.5 / 1e6, 12);
  });

  it("leaves other routes and models on their existing fallback", () => {
    const generic = { input: 2, output: 10, cached: 0.1, reasoning: 10, cache_creation: 0.1875 };
    expect(getPricingForModel("antigravity", model)).toEqual(generic);
    expect(getPricingForModel("gemini", model)).toEqual(generic);
    expect(getPricingForModel(provider, "gemini-4-other")).toEqual(generic);
  });

  it("merges and resets a user override over the scoped default", async () => {
    await repo.updatePricing({ [provider]: { [model]: { input: 4.25 } } });
    const resolved = await repo.resolvePricingForModel(provider, model);
    expect(resolved.pricing).toEqual({ ...rates, input: 4.25 });
    expect(resolved.provenance.source).toBe("override");
    await repo.resetPricing(provider, model);
    expect(await repo.getPricingForModel(provider, model)).toEqual(rates);
  });
});
