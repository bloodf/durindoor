/**
 * Context-window resolution audit.
 *
 * These assertions pin the operator-observable `contextWindow` for flagship
 * families against their published windows (models.dev / vendor docs). Two were
 * genuine regressions before this audit:
 *   - claude-opus-4.6/4.7 "-thinking" variants resolved to the generic 200K
 *     budget floor instead of their real 1M window (no exact row; the
 *     *claude*opus-4.6* pattern does not match the dash form and carries no
 *     contextWindow).
 *   - glm-5 / glm-5.1 / glm-5-turbo carried a wrong 1M exact override; the
 *     official z.ai window is 200K (only glm-5.2 is 1M).
 */
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("capabilities contextWindow resolution", () => {
  it.each([
    // Claude Opus 4.6/4.7/4.8 and their -thinking + dash forms are all 1M.
    ["anthropic", "claude-opus-4-6", 1000000],
    ["anthropic", "claude-opus-4-7", 1000000],
    ["anthropic", "claude-opus-4-8", 1000000],
    ["anthropic", "claude-opus-4-6-thinking", 1000000],
    ["anthropic", "claude-opus-4-7-thinking", 1000000],
    ["anthropic", "claude-opus-4.6-thinking", 1000000],
    ["anthropic", "claude-opus-4.7-thinking", 1000000],
    // GPT-5.x codex family keeps DurinDoor's 400K provider cap.
    ["codex", "gpt-5.6-sol-ultra", 400000],
    ["openai", "gpt-5.5", 400000],
    // Kimi K2.x = 256K (262144).
    ["moonshot", "kimi-k2.7", 262144],
    ["moonshot", "kimi-k2.5", 262144],
    // MiniMax M2.x = 200K (204800); M3 = 512K.
    ["minimax", "minimax-m2.5", 204800],
    ["minimax", "minimax-m2.7", 204800],
    ["minimax", "minimax-m3", 512000],
    // Z.ai GLM: 5.2 is 1M, 5/5.1 are 200K, 4.7 is 200K.
    ["zai", "glm-5.2", 1000000],
    ["zai", "glm-5", 200000],
    ["zai", "glm-5.1", 200000],
    ["zai", "glm-4.7", 200000],
  ])("%s/%s resolves to contextWindow %d", (provider, model, expected) => {
    expect(getCapabilitiesForModel(provider, model).contextWindow).toBe(expected);
  });

  it("keeps glm-4.6v vision even at its 128K window", () => {
    const caps = getCapabilitiesForModel("zai", "glm-4.6v");
    expect(caps.contextWindow).toBe(128000);
    expect(caps.vision).toBe(true);
  });

  it("never lets the generic claude budget pattern win over the opus-4.6/4.7 1M window", () => {
    // The bug this guards: an exact -thinking id must beat *claude*opus* (200K).
    for (const id of ["claude-opus-4-6-thinking", "claude-opus-4-7-thinking"]) {
      expect(getCapabilitiesForModel("anthropic", id).contextWindow).toBe(1000000);
    }
  });
});
