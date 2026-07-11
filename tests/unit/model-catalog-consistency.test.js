/**
 * Model catalog consistency drift guard.
 *
 * Runs the M-1 local audit (`scripts/model-catalog-diff.mjs::localAudit`)
 * programmatically against the live registry + pricing and asserts the catalog
 * is clean: no duplicate ids per provider, all ids nonempty strings, every
 * `upstreamModelId` resolves, every `targetFormat` ∈ FORMATS, no orphan pricing
 * rows. No ordering assertions (model-array order is behavior; see plan M-2).
 *
 * Gate semantics
 * ──────────────
 * The FINAL assertion in the single test below is the real gate: it requires
 * zero findings. On `dev` today the audit reports the 37 findings catalogued
 * in `KNOWN_BASELINE`, so this test FAILS there — that is intentional and is
 * what proves the gate works. The test PASSES only after the M-2 catalog
 * refresh resolves every finding (at which point the baseline must be cleared).
 *
 * The FIRST assertion is a tripwire, not the gate: it accepts either the exact
 * documented baseline OR the empty set, and fails on anything else. That way a
 * *new* finding (or a known one that silently changes shape) is caught as
 * unexpected drift instead of being absorbed into a fuzzy snapshot, while the
 * post-cleanup empty state is also accepted. It does NOT gate cleanliness.
 */
import { describe, expect, it } from "vitest";

// Exact finding set reported by `node scripts/model-catalog-diff.mjs` on dev
// (HEAD fde0422a1b). Sorted for deterministic comparison. Must equal the live
// audit output today; cleared to empty only when the M-2 refresh lands.
const KNOWN_BASELINE = [
  `[blackbox] model "claude-fable-5" upstreamModelId "blackboxai/anthropic/claude-fable-5" resolves to no id in this provider`,
  `[blackbox] model "claude-opus-4.8" upstreamModelId "blackboxai/anthropic/claude-opus-4.8" resolves to no id in this provider`,
  `[blackbox] model "claude-sonnet-4.6" upstreamModelId "blackboxai/anthropic/claude-sonnet-4.6" resolves to no id in this provider`,
  `[blackbox] model "deepseek-v4-flash" upstreamModelId "blackboxai/deepseek/deepseek-v4-flash" resolves to no id in this provider`,
  `[blackbox] model "gpt-5.3-codex" upstreamModelId "blackboxai/openai/gpt-5.3-codex" resolves to no id in this provider`,
  `[blackbox] model "gpt-5.4" upstreamModelId "blackboxai/openai/gpt-5.4" resolves to no id in this provider`,
  `[blackbox] model "gpt-5.4-nano" upstreamModelId "blackboxai/openai/gpt-5.4-nano" resolves to no id in this provider`,
  `[blackbox] model "gpt-5.4-pro" upstreamModelId "blackboxai/openai/gpt-5.4-pro" resolves to no id in this provider`,
  `[blackbox] model "gpt-5.5" upstreamModelId "blackboxai/openai/gpt-5.5" resolves to no id in this provider`,
  `[blackbox] model "grok-4.3" upstreamModelId "blackboxai/x-ai/grok-4.3" resolves to no id in this provider`,
  `[clinepass] model "deepseek-v4-flash" upstreamModelId "cline-pass/deepseek-v4-flash" resolves to no id in this provider`,
  `[clinepass] model "deepseek-v4-pro" upstreamModelId "cline-pass/deepseek-v4-pro" resolves to no id in this provider`,
  `[clinepass] model "glm-5.2" upstreamModelId "cline-pass/glm-5.2" resolves to no id in this provider`,
  `[clinepass] model "kimi-k2.6" upstreamModelId "cline-pass/kimi-k2.6" resolves to no id in this provider`,
  `[clinepass] model "kimi-k2.7-code" upstreamModelId "cline-pass/kimi-k2.7-code" resolves to no id in this provider`,
  `[clinepass] model "mimo-v2.5" upstreamModelId "cline-pass/mimo-v2.5" resolves to no id in this provider`,
  `[clinepass] model "mimo-v2.5-pro" upstreamModelId "cline-pass/mimo-v2.5-pro" resolves to no id in this provider`,
  `[clinepass] model "minimax-m3" upstreamModelId "cline-pass/minimax-m3" resolves to no id in this provider`,
  `[clinepass] model "qwen3.7-max" upstreamModelId "cline-pass/qwen3.7-max" resolves to no id in this provider`,
  `[clinepass] model "qwen3.7-plus" upstreamModelId "cline-pass/qwen3.7-plus" resolves to no id in this provider`,
  `[gemini] duplicate model id "gemini-2.5-flash" (indices 4, 15)`,
  `[gemini] duplicate model id "gemini-2.5-flash-lite" (indices 5, 16)`,
  `[gemini] duplicate model id "gemini-2.5-pro" (indices 3, 14)`,
  `[gemini] duplicate model id "gemini-3.1-flash-tts-preview" (indices 18, 21)`,
  `pricing MODEL_PRICING["claude-opus-4-5-20251101"] matches no registry model id`,
  `pricing MODEL_PRICING["claude-opus-4-5-thinking"] matches no registry model id`,
  `pricing MODEL_PRICING["claude-opus-4.1"] matches no registry model id`,
  `pricing MODEL_PRICING["claude-sonnet-4-5-20250929"] matches no registry model id`,
  `pricing MODEL_PRICING["deepseek-v3.2-chat"] matches no registry model id`,
  `pricing MODEL_PRICING["deepseek-v3.2-reasoner"] matches no registry model id`,
  `pricing MODEL_PRICING["gemini-3.1-pro-high"] matches no registry model id`,
  `pricing MODEL_PRICING["gpt-3.5-turbo"] matches no registry model id`,
  `pricing MODEL_PRICING["gpt-5.1-codex-mini-high"] matches no registry model id`,
  `pricing MODEL_PRICING["gpt-5.6"] matches no registry model id`,
  `pricing MODEL_PRICING["minimax-m2.1"] matches no registry model id`,
  `pricing PATTERN_PRICING "*-codex-mini-*" matches no registry model id`,
  `pricing PATTERN_PRICING "codex-*" matches no registry model id`,
].sort();

const format = (findings) => findings.map((f) => `  - ${f}`).join("\n");

describe("model catalog consistency", () => {
  it("has zero drift-guard findings (fails on dev until M-2 cleanup lands)", async () => {
    const { localAudit } = await import("../../scripts/model-catalog-diff.mjs");
    const findings = (await localAudit()).sort();

    // Tripwire: findings must be EITHER the documented baseline (current dev)
    // OR empty (post-M-2). Anything else = unexpected drift; investigate before
    // touching KNOWN_BASELINE. Accepts empty so this same assertion keeps
    // passing after cleanup and never blocks the gate below from turning green.
    const matchesBaseline =
      findings.length === KNOWN_BASELINE.length &&
      findings.every((f, i) => f === KNOWN_BASELINE[i]);
    const isClean = findings.length === 0;
    expect(
      matchesBaseline || isClean,
      `catalog findings changed unexpectedly (neither the ${KNOWN_BASELINE.length}-finding baseline nor clean).\n` +
        `Actual (${findings.length}):\n${format(findings)}`
    ).toBe(true);

    // THE GATE: zero findings required. Fails on current dev (37 findings,
    // listed below); passes only after M-2 resolves every entry. Failure text
    // enumerates the live findings so a red run is self-explanatory.
    expect(
      findings,
      `model catalog consistency gate failed — resolve every finding (documented in KNOWN_BASELINE above):\n${format(
        findings
      )}`
    ).toEqual([]);
  });
});
