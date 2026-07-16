import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";
import { XaiExecutor } from "../../open-sse/executors/xai.js";

// OmniRoute#6938 (upstream "fix(grok): strip reasoningEffort for grok cli models";
// plan row OmniRoute#6937): xAI's cli-chat-proxy 400s on reasoning params for
// non-reasoning Grok CLI models (grok-build, grok-composer-2.5-fast), whose catalog
// entries mark `reasoning: false`. dev satisfies this semantically inside
// GrokCliExecutor.transformRequest() (open-sse/executors/grok-cli.js): when
// caps.reasoning === false the outbound body drops `reasoning`, and
// `reasoning_effort` — the source-side hint — is always removed; for capable models
// it is converted into the Responses-native `reasoning: { effort, summary }` shape.
// These tests pin the strip, the conversion, and a cross-executor control so a
// regression in either direction fails.
describe("grok-cli reasoning effort strip (omniroute-6937)", () => {
  it("strips reasoning_effort and reasoning for non-reasoning grok-build, keeps allowed fields", () => {
    const executor = new GrokCliExecutor();
    const out = executor.transformRequest(
      "grok-build",
      {
        model: "grok-build",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "high",
        reasoning: { effort: "high" },
        temperature: 0.4,
        top_p: 0.8,
      },
      false,
      {},
    );

    // Both source shapes of the unsupported reasoning param are gone.
    expect("reasoning_effort" in out).toBe(false);
    expect("reasoning" in out).toBe(false);
    // include must not carry reasoning.encrypted_content for a stripped request.
    expect(out.include || []).not.toContain("reasoning.encrypted_content");
    // Unrelated allowed fields survive untouched.
    expect(out.temperature).toBe(0.4);
    expect(out.top_p).toBe(0.8);
    expect(out.input).toEqual([{ type: "message", role: "user", content: "hi" }]);
    expect(out.model).toBe("grok-build");
  });

  it("strips reasoning_effort for non-reasoning grok-composer-2.5-fast", () => {
    const executor = new GrokCliExecutor();
    const out = executor.transformRequest(
      "grok-composer-2.5-fast",
      {
        model: "grok-composer-2.5-fast",
        messages: [{ role: "user", content: "ok" }],
        reasoning_effort: "low",
      },
      false,
      {},
    );

    expect("reasoning_effort" in out).toBe(false);
    expect("reasoning" in out).toBe(false);
  });

  it("converts reasoning_effort into reasoning.effort for reasoning-capable grok-cli models", () => {
    const executor = new GrokCliExecutor();
    const out = executor.transformRequest(
      "grok-code-fast-1",
      {
        model: "grok-code-fast-1",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "low",
      },
      false,
      {},
    );

    // Source param consumed, converted into the Responses-native shape.
    expect("reasoning_effort" in out).toBe(false);
    expect(out.reasoning).toEqual({ effort: "low", summary: "concise" });
    expect(out.include).toContain("reasoning.encrypted_content");
  });

  it("control: non-grok-cli xAI executor preserves reasoning_effort for reasoning-capable models", () => {
    const xai = new XaiExecutor();
    const out = xai.transformRequest("grok-4", {
      model: "grok-4",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    });

    // Outside the grok-cli request path the field is NOT stripped.
    expect(out.reasoning_effort).toBe("high");
  });
});
