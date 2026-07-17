// Regression coverage for upstream 9router PR #2452 (restacked onto #2523).
//
// Ports ONLY the #2452-unique observable contracts into DurinDoor:
//   1. Codex priority/fast tier is disabled when the estimated input token
//      count crosses CODEX_PRIORITY_ESTIMATED_INPUT_LIMIT (256K).
//   2. Estimator counts whitespace-heavy input conservatively.
//   3. Non-GPT models are never demoted from "priority".
//
// The shared "GPT-5.6 effort" theme (resolveOpenAiEffort /
// resolveCodexWireEffort / per-model thinking levels) is #2523's canonical
// treatment and is covered by tests/unit/codex-effort-wire.test.js,
// codex-fast-capacity.test.js, thinking-effort-openai-max-clamp.test.js, and
// thinking-levels-gpt56-sol.test.js at base 7c021f328b.
//
// Upstream head SHA: b175293a3dd8318a38895fac81bd28ff617a9e85.
import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

describe("port/upstream-2452-codex-fast-tier", () => {
  const longInput = "word ".repeat(220_000); // ~1.1MB; estimate >> 256K tokens

  describe("Codex priority/fast tier is disabled for long GPT contexts", () => {
    it("fast tier is removed when estimated input crosses the limit", () => {
      const executor = new CodexExecutor();
      const body = executor.transformRequest(
        "gpt-5.6-sol",
        { model: "gpt-5.6-sol", input: longInput, service_tier: "fast" },
        true,
        {},
      );
      expect(body.service_tier).toBeUndefined();
    });

    it("explicit priority tier is removed when estimated input crosses the limit", () => {
      const executor = new CodexExecutor();
      const body = executor.transformRequest(
        "gpt-5.6-sol",
        { model: "gpt-5.6-sol", input: longInput, service_tier: "priority" },
        true,
        {},
      );
      expect(body.service_tier).toBeUndefined();
    });

    it("whitespace-heavy input is counted conservatively and disables priority", () => {
      const executor = new CodexExecutor();
      const body = executor.transformRequest(
        "gpt-5.6-sol",
        { model: "gpt-5.6-sol", input: `x${" ".repeat(1_024_000)}`, service_tier: "fast" },
        true,
        {},
      );
      expect(body.service_tier).toBeUndefined();
    });

    it("fast tier still upgrades to priority on short GPT contexts", () => {
      const executor = new CodexExecutor();
      const body = executor.transformRequest(
        "gpt-5.5",
        { model: "gpt-5.5", input: "hi", service_tier: "fast" },
        true,
        {},
      );
      expect(body.service_tier).toBe("priority");
    });

    it("non-GPT models keep priority regardless of input length", () => {
      const executor = new CodexExecutor();
      const body = executor.transformRequest(
        "claude-opus-4.8",
        { model: "claude-opus-4.8", input: longInput, service_tier: "priority" },
        true,
        {},
      );
      expect(body.service_tier).toBe("priority");
    });

    it("estimator counts mixed-token input above the 256K threshold", () => {
      // Boundary sanity: each "word " is 5 chars => ~1 token per part.
      const executor = new CodexExecutor();
      const body = executor.transformRequest(
        "gpt-5.6-sol",
        { model: "gpt-5.6-sol", input: "w".repeat(1_024_000), service_tier: "fast" },
        true,
        {},
      );
      expect(body.service_tier).toBeUndefined();
    });
  });
});
