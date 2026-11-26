import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { calculateCostBreakdown } from "../../open-sse/providers/pricing.js";
import { canonicalizeUsage, extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const PRICING = { input: 10, output: 50, cache_creation: 12.5 };
const CLAUDE = { provider: "claude", model: "claude-sonnet-4-6" };
const M = 1_000_000;

const nativeUsage = (oneHour, total = 2 * M) => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: total,
  cache_creation: { ephemeral_5m_input_tokens: total - oneHour, ephemeral_1h_input_tokens: oneHour },
});
const price = (usage, route = CLAUDE, pricing = PRICING) =>
  calculateCostBreakdown(canonicalizeUsage(usage), pricing, route).cacheCreationCost;

describe("OmniRoute #19720 - 1-hour cache writes", () => {
  it("bills the 1-hour share at 2x input and the remainder at the 5-minute rate", () => {
    expect(price(nativeUsage(M))).toBeCloseTo(20 + 12.5);
    expect(price(nativeUsage(0))).toBeCloseTo(25);
  });

  it("prefers an explicit cache_creation_1h rate on any route", () => {
    expect(price(nativeUsage(M), { provider: "openrouter", model: "x" }, { ...PRICING, cache_creation_1h: 30 }))
      .toBeCloseTo(30 + 12.5);
  });

  it("keeps the single rate for other routes and for a count above the total", () => {
    expect(price(nativeUsage(M), { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" })).toBeCloseTo(25);
    expect(price({ ...nativeUsage(0), cache_creation: { ephemeral_1h_input_tokens: 5 * M } })).toBeCloseTo(25);
  });

  it("keeps the share from a non-streaming reply", () => {
    expect(extractUsageFromResponse({ usage: nativeUsage(M) }).cache_creation_1h_input_tokens).toBe(M);
  });

  it("keeps the share when the stream translator rewrites its usage state", () => {
    const state = { toolCalls: new Map() };
    const events = [
      { type: "message_start", message: { id: "msg_1", model: CLAUDE.model, usage: nativeUsage(M) } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
    ];
    for (const event of events) {
      state.usage = mergeUsage(state.usage, extractUsage(event));
      claudeToOpenAIResponse(event, state);
    }
    expect(canonicalizeUsage(state.usage).cache_creation_1h_input_tokens).toBe(M);
  });

  describe("usage ledger", () => {
    let tempDir;
    let originalDataDir;

    beforeAll(() => {
      originalDataDir = process.env.DATA_DIR;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portor-19720-"));
      process.env.DATA_DIR = tempDir;
      delete global._dbAdapter;
      vi.resetModules();
    });

    afterAll(async () => {
      await disposeLoadedRequestDetailsRepo();
      try { global._dbAdapter?.instance?.close?.(); } catch {}
      delete global._dbAdapter;
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("prices and stores the 1-hour share", async () => {
      const database = await import("@/lib/db/index.js");
      await database.saveRequestUsage({
        provider: "claude", model: CLAUDE.model, tokens: canonicalizeUsage(nativeUsage(M)),
        timestamp: new Date().toISOString(),
      });

      const [row] = await database.getUsageHistory({ provider: "claude" });
      const { getPricingForModel } = await import("@/lib/db/repos/pricingRepo.js");
      const rates = await getPricingForModel("claude", CLAUDE.model);

      expect(row.tokens.cache_creation_1h_input_tokens).toBe(M);
      expect(row.cost).toBeCloseTo(rates.input * 2 + rates.cache_creation);
    });
  });
});
