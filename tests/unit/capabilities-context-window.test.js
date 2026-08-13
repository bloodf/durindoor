/**
 * Context-window resolution audit.
 *
 * These assertions pin operator-observable `contextWindow` values. Confirmed
 * values cite live/provider evidence at the relevant assertion; GLM-5.2/5.1/5
 * and 4.7 remain stored-value regressions because the 2026-08-13 live catalog
 * and detail probes returned no limit fields, and overflow probes hit quota
 * exhaustion before context validation.
 *
 * One genuine regression covered here: claude-opus-4.6/4.7 "-thinking"
 * variants resolved to the generic 200K budget floor instead of their 1M
 * window (no exact row; the *claude*opus-4.6* pattern does not match the dash
 * form and carries no contextWindow).
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
    // Direct OpenAI GPT-5.6 surfaces override the generic *gpt-5* 400K fallback.
    ["openai", "gpt-5.5", 1050000],
    ["openai", "gpt-5.6", 1050000],
    ["openai", "gpt-5.6-sol", 1050000],
    ["openai", "gpt-5.6-terra", 1050000],
    ["openai", "gpt-5.6-luna", 1050000],
    // The ChatGPT/Codex subscription surface serves gpt-5.5 at 272K, while
    // direct OpenAI remains 1.05M. Source: chatgpt.com/backend-api/codex/models.
    ["codex", "gpt-5.5", 272000],
    ["codex", "gpt-5.5-review", 272000],
    ["codex", "gpt-5.6-sol", 1050000],
    ["codex", "gpt-5.6-sol-review", 1050000],
    ["codex", "gpt-5.6-sol-ultra", 1050000],
    ["codex", "gpt-5.6-terra", 1050000],
    ["codex", "gpt-5.6-terra-review", 1050000],
    ["codex", "gpt-5.6-luna", 1050000],
    ["codex", "gpt-5.6-luna-review", 1050000],
    ["cx", "gpt-5.5", 272000],
    ["cx", "gpt-5.5-review", 272000],
    ["cx", "gpt-5.6-sol-review", 1050000],
    ["cx", "gpt-5.6-terra-review", 1050000],
    ["cx", "gpt-5.6-luna-review", 1050000],
    // Kimi values below are pinned separately against live API evidence.
    // MiniMax M2.x = 200K (204800); M3 = 512K.
    ["minimax", "minimax-m2.5", 204800],
    ["minimax", "minimax-m2.7", 204800],
    ["minimax", "minimax-m3", 512000],
    // Stored GLM values remain pinned but unverified by live API limit fields.
    ["zai", "glm-5.2", 1000000],
    ["zai", "glm-5", 200000],
    ["zai", "glm-5.1", 200000],
    ["zai", "glm-4.7", 200000],
  ])("%s/%s resolves to contextWindow %d", (provider, model, expected) => {
    expect(getCapabilitiesForModel(provider, model).contextWindow).toBe(expected);
  });

  it.each([
    ["kimi-k3", 1048576],
    ["k3", 1048576],
    ["k3-256k", 262144],
    ["kimi-k2.7-code", 262144],
    ["kimi-k2.7-code-highspeed", 262144],
    ["kimi-k2.6", 262144],
    ["kimi-k2.5", 262144],
  ])("keeps live-probed Kimi %s window at %d", (model, expected) => {
    // 2026-08-13: Kimi `/coding/v1/models` returned exact k3/k3-256k context_length;
    // deliberate K2.7/K2.6/K2.5 overflow errors stated model token limit 262144.
    expect(getCapabilitiesForModel("kimi", model).contextWindow).toBe(expected);
  });

  it("keeps glm-4.6v vision even at its 128K window", () => {
    const caps = getCapabilitiesForModel("zai", "glm-4.6v");
    expect(caps.contextWindow).toBe(128000);
    expect(caps.vision).toBe(true);
  });

  it.each([
    ["openai", "gpt-5.5"],
    ["openai", "gpt-5.6"],
    ["openai", "gpt-5.6-sol"],
    ["openai", "gpt-5.6-terra"],
    ["openai", "gpt-5.6-luna"],
    ["codex", "gpt-5.6-sol"],
    ["codex", "gpt-5.6-sol-review"],
    ["codex", "gpt-5.6-sol-ultra"],
    ["codex", "gpt-5.6-terra"],
    ["codex", "gpt-5.6-terra-review"],
    ["codex", "gpt-5.6-luna"],
    ["codex", "gpt-5.6-luna-review"],
    ["cx", "gpt-5.6-sol-review"],
    ["cx", "gpt-5.6-terra-review"],
    ["cx", "gpt-5.6-luna-review"],
  ])("%s/%s exposes 1.05M context and 128K max output", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps.contextWindow).toBe(1050000);
    expect(caps.maxOutput).toBe(128000);
  });

  it.each(["codex", "cx"])("uses the tighter ChatGPT subscription limit for %s/gpt-5.5", (provider) => {
    // Source: chatgpt.com/backend-api/codex/models; direct openai/gpt-5.5 remains
    // separately guarded above at 1.05M context and 128K output.
    expect(getCapabilitiesForModel(provider, "gpt-5.5")).toMatchObject({
      contextWindow: 272000,
      maxOutput: undefined,
    });
  });

  it("never lets the generic claude budget pattern win over the opus-4.6/4.7 1M window", () => {
    // The bug this guards: an exact -thinking id must beat *claude*opus* (200K).
    for (const id of ["claude-opus-4-6-thinking", "claude-opus-4-7-thinking"]) {
      expect(getCapabilitiesForModel("anthropic", id).contextWindow).toBe(1000000);
    }
  });
});
