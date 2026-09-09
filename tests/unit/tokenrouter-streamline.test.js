import { describe, it, beforeAll } from "vitest";
import assert from "node:assert/strict";

// Covers the upstream sync decolua/9router@6efb9790: the tokenrouter seed
// catalog is pruned to flagship/newest models while the fork keeps its
// free-tier minimax-3 entry and enriched DeepSeek metadata, and the
// z-ai/glm-5.3-free model is priced at 0.
//
// The registry entry and PROVIDER_PRICING are imported directly (pure data
// modules), mirroring the load pattern in kimchi.test.js.

let tokenrouterEntry;
let PROVIDER_PRICING;

describe("tokenrouter streamlined seed catalog", () => {
  beforeAll(async () => {
    tokenrouterEntry = (await import("../../open-sse/providers/registry/tokenrouter.js")).default;
    ({ PROVIDER_PRICING } = await import("../../open-sse/providers/pricing.js"));
  });

  it("keeps the seed small (pruned to flagship/newest + fork free-tier entry)", () => {
    assert.ok(Array.isArray(tokenrouterEntry.models));
    assert.ok(
      tokenrouterEntry.models.length <= 25,
      `expected a pruned seed (<= 25), got ${tokenrouterEntry.models.length}`,
    );
  });

  it("contains the upstream flagship additions", () => {
    const ids = tokenrouterEntry.models.map((m) => m.id);
    for (const id of [
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-opus-4.8",
      "openai/gpt-5.5",
      "google/gemini-3.6-flash",
      "qwen/qwen3.8-max",
      "moonshotai/kimi-k3-free",
      "z-ai/glm-5.3-free",
      "x-ai/grok-4.5",
    ]) {
      assert.ok(ids.includes(id), `missing upstream flagship model: ${id}`);
    }
  });

  it("keeps the fork-specific free-tier minimax-3 entry", () => {
    const entry = tokenrouterEntry.models.find((m) => m.id === "minimax-3");
    assert.ok(entry, "minimax-3 free-tier entry must be preserved");
    assert.equal(entry.toolCalling, true);
    assert.equal(entry.contextLength, 128000);
  });

  it("carries enriched DeepSeek metadata on the namespaced upstream ids", () => {
    for (const id of ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"]) {
      const entry = tokenrouterEntry.models.find((m) => m.id === id);
      assert.ok(entry, `missing ${id}`);
      assert.equal(entry.contextLength, 163840);
      assert.equal(entry.toolCalling, true);
      assert.equal(entry.supportsReasoning, true);
    }
  });

  it("does not duplicate DeepSeek under both bare and namespaced ids", () => {
    const ids = tokenrouterEntry.models.map((m) => m.id);
    assert.ok(!ids.includes("deepseek-v4-flash"), "stale bare id still present");
    assert.ok(!ids.includes("deepseek-v4-pro"), "stale bare id still present");
  });

  it("prices z-ai/glm-5.3-free at zero for the tokenrouter provider", () => {
    const rate = PROVIDER_PRICING.tokenrouter?.["z-ai/glm-5.3-free"];
    assert.ok(rate, "missing tokenrouter pricing override for z-ai/glm-5.3-free");
    assert.deepEqual(rate, { input: 0, output: 0, cached: 0, reasoning: 0 });
  });

  it("still fetches the live catalog via modelsFetcher", () => {
    assert.equal(tokenrouterEntry.modelsFetcher.url, "https://api.tokenrouter.com/v1/models");
    assert.equal(tokenrouterEntry.modelsFetcher.type, "openai");
  });
});
