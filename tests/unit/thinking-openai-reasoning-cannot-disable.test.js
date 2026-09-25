import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// Regression for decolua/9router#4048 (refs #4031). OpenAI's reasoning models
// reject the value outright:
//   400 Unsupported value: 'reasoning_effort' does not support 'none'
// A request that merely omits reasoning_effort was failing because
// applyThinking wrote "none" for the GPT-5.6 family on Codex/Kiro. The
// mechanism to avoid that already existed -- `thinkingCanDisable: false`
// clamps to the minimum instead of disabling -- these entries simply did not
// declare it.
const CODEX_REASONING_MODELS = [
  ["codex", "gpt-5.6-sol"],
  ["codex", "gpt-5.6-terra"],
  ["codex", "gpt-5.6-luna"],
  ["codex", "gpt-5.6-sol-review"],
];

// Kiro's own wire format handles thinking via a system-tag injection
// (open-sse/translator/request/openai-to-kiro.js), not `reasoning_effort`,
// so only the advertised-level side of the flag is testable through
// getThinkingLevels here; the OpenAI wire path is covered by Codex above.
const KIRO_REASONING_MODELS = [
  ["kiro", "gpt-5.6-sol"],
  ["kiro", "gpt-5.6-terra"],
  ["kiro", "gpt-5.6-luna"],
];

describe("#4048 GPT-5.6 Codex/Kiro cannot disable thinking", () => {
  it.each(CODEX_REASONING_MODELS)("%s/%s never sends reasoning_effort:none", (provider, model) => {
    const out = applyThinking(FORMATS.OPENAI, model, { reasoning_effort: "none" }, provider);
    expect(out.reasoning_effort).not.toBe("none");
    expect(out.reasoning_effort).toBe("minimal");
  });

  it.each([...CODEX_REASONING_MODELS, ...KIRO_REASONING_MODELS])("%s/%s does not advertise none as a level", (provider, model) => {
    expect(getThinkingLevels(provider, model)).not.toContain("none");
  });

  it("an explicit level still passes through", () => {
    // Accept control: clamping "none" must not flatten every request to the
    // minimum. A caller asking for high still gets high.
    const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-sol", { reasoning_effort: "high" }, "codex");
    expect(out.reasoning_effort).toBe("high");
  });

  it("a model that CAN disable still disables", () => {
    // The other accept control. thinkingCanDisable is per model; a plain
    // openai-format model without the flag must keep its "none".
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", { reasoning_effort: "none" }, "openai");
    expect(out.reasoning_effort).toBe("none");
    expect(getThinkingLevels("openai", "gpt-5")).toContain("none");
  });

  it("direct OpenAI API gpt-5.6-terra is unaffected (Codex-only clamp)", () => {
    // The Codex-only override must not leak onto the direct OpenAI API
    // surface, which uses a separate capability row.
    const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-terra", { reasoning_effort: "none" }, "openai");
    expect(out.reasoning_effort).toBe("none");
  });
});
