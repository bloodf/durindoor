// tests/unit/pricingRepo-kiro-override.test.js
// Defends Kiro GPT-5.6 user-pricing-override precedence (#2596):
// a user override saved on the BARE tier (kiro["gpt-5.6-sol"]) must also cover
// its `-thinking`/`-agentic` synthetic variants, scoped to kiro/kr only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let pricingRepo;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pricing-kiro-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  pricingRepo = await import("@/lib/db/repos/pricingRepo.js");
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("pricingRepo kiro synthetic user-override (#2596)", () => {
  it("bare kiro override covers -thinking and -agentic variants", async () => {
    const custom = { input: 9.99, output: 19.99 };
    await pricingRepo.updatePricing({ kiro: { "gpt-5.6-sol": custom } });

    expect(await pricingRepo.getPricingForModel("kiro", "gpt-5.6-sol")).toMatchObject(custom);
    expect(await pricingRepo.getPricingForModel("kiro", "gpt-5.6-sol-thinking")).toMatchObject(custom);
    expect(await pricingRepo.getPricingForModel("kiro", "gpt-5.6-sol-agentic")).toMatchObject(custom);
  });

  it("kr alias override covers synthetic variants", async () => {
    const custom = { input: 7.77, output: 17.77 };
    await pricingRepo.updatePricing({ kr: { "gpt-5.6-luna": custom } });

    expect(await pricingRepo.getPricingForModel("kr", "gpt-5.6-luna-thinking")).toMatchObject(custom);
    expect(await pricingRepo.getPricingForModel("kr", "gpt-5.6-luna-agentic")).toMatchObject(custom);
  });

  it("non-kiro provider override does NOT strip -thinking (exact-key only)", async () => {
    const custom = { input: 1.23, output: 4.56 };
    await pricingRepo.updatePricing({ openai: { "gpt-5.6-sol": custom } });

    // Bare key resolves; the -thinking variant must NOT inherit the override.
    expect(await pricingRepo.getPricingForModel("openai", "gpt-5.6-sol")).toMatchObject(custom);
    const thinking = await pricingRepo.getPricingForModel("openai", "gpt-5.6-sol-thinking");
    expect(thinking).not.toMatchObject(custom);
  });

  it("resetPricing restores const fallback for kiro synthetic variant", async () => {
    const custom = { input: 3.33, output: 6.66 };
    await pricingRepo.updatePricing({ kiro: { "gpt-5.6-terra": custom } });
    expect(await pricingRepo.getPricingForModel("kiro", "gpt-5.6-terra-thinking")).toMatchObject(custom);

    await pricingRepo.resetPricing("kiro", "gpt-5.6-terra");
    const after = await pricingRepo.getPricingForModel("kiro", "gpt-5.6-terra-thinking");
    // Const fallback for terra is 2.50/15.00 — not the removed override.
    expect(after).not.toMatchObject(custom);
  });
});
