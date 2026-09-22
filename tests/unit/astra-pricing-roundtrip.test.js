import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let GET;
let PATCH;
let pricingRepo;

const patch = (body) => PATCH(new Request("http://localhost/api/pricing", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-astra-pricing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  pricingRepo = await import("@/lib/db/repos/pricingRepo.js");
  ({ GET, PATCH } = await import("../../src/app/api/pricing/route.js"));
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Astra pricing API roundtrip", () => {
  it("accepts unchanged GET data, saves edited rates, and preserves server-owned long-context tiers", async () => {
    const initial = await GET();
    expect(initial.status).toBe(200);
    const pricing = await initial.json();
    pricing.openai["gpt-6-astra"].input = 12;

    const saved = await patch(pricing);
    expect(saved.status).toBe(200);

    const stored = (await pricingRepo.getUserPricing()).openai["gpt-6-astra"];
    expect(stored).toEqual({
      input: 12,
      output: 50,
      cached: 1,
      reasoning: 50,
      cache_creation: 12.5,
    });
    expect(stored).not.toHaveProperty("longContextThreshold");
    expect(stored).not.toHaveProperty("longContextInputMultiplier");
    expect(stored).not.toHaveProperty("longContextOutputMultiplier");

    const astra = await pricingRepo.getPricingForModel("openai", "gpt-6-astra");
    expect(astra).toMatchObject({
      input: 12,
      cached: 1,
      cache_creation: 12.5,
      longContextThreshold: 272000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
    });

    const merged = await pricingRepo.getPricing();
    expect(merged.openai["gpt-6-astra"]).toMatchObject({
      input: 12,
      longContextThreshold: 272000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
    });
  });

  // PROVIDER_PRICING.xai carries longContextInclusive; it must round-trip like
  // the other server-owned tier fields and stay server-owned after an edit.
  it("round-trips the xAI inclusive long-context tier and rejects a forged flag", async () => {
    const pricing = await (await GET()).json();
    expect(pricing.xai["grok-code-fast-1"].longContextInclusive).toBe(true);
    pricing.xai["grok-code-fast-1"].input = 1.5;
    expect((await patch(pricing)).status).toBe(200);

    expect(await pricingRepo.getPricingForModel("xai", "grok-code-fast-1")).toMatchObject({
      input: 1.5,
      longContextThreshold: 200000,
      longContextInclusive: true,
    });
    expect((await pricingRepo.getUserPricing()).xai["grok-code-fast-1"]).not.toHaveProperty("longContextInclusive");

    const forged = await patch({ xai: { "grok-code-fast-1": { input: 1, longContextInclusive: false } } });
    expect(forged.status).toBe(400);
  });

  it("rejects altered tier metadata and arrays at the pricing boundary", async () => {
    const forgedTier = await patch({
      openai: {
        "gpt-6-astra": { input: 12, longContextInputMultiplier: 0 },
      },
    });
    expect(forgedTier.status).toBe(400);

    const arrayBody = await patch([]);
    expect(arrayBody.status).toBe(400);
  });
});
