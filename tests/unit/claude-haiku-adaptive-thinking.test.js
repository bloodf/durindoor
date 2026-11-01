import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("normalizeClaudePassthrough — Haiku adaptive thinking (#5183)", () => {
  it("keeps adaptive thinking and effort for Haiku 5.5 models", () => {
    const models = [
      "claude-haiku-5-5",
      "claude-haiku-5.5",
      "anthropic/claude-haiku-5-5",
      "claude-5.5-haiku",
      "cc/claude-5-5-haiku-20261001",
      "CLAUDE-HAIKU-5.5",
    ];

    for (const model of models) {
      const body = {
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "low" },
      };
      const out = normalizeClaudePassthrough(body, model);
      expect(out.thinking, `model ${model} should keep adaptive thinking`).toEqual({
        type: "adaptive",
        display: "summarized",
      });
      expect(out.output_config, `model ${model} should keep output_config.effort`).toEqual({
        effort: "low",
      });
    }
  });

  it("downgrades adaptive thinking and strips effort for Haiku 3.x and 4.x models", () => {
    const models = [
      "claude-haiku-4-5",
      "claude-haiku-4.5",
      "claude-4.5-haiku",
      "claude-haiku-4-5-20251001",
      "claude-3-5-haiku-20241022",
      "claude-3-haiku-20240307",
      "haiku",
      "claude-haiku-latest",
    ];

    for (const model of models) {
      const body = {
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
      };
      const out = normalizeClaudePassthrough(body, model);
      expect(out.thinking, `model ${model} should downgrade thinking`).toEqual({
        type: "enabled",
        budget_tokens: 10000,
      });
      expect(out.output_config, `model ${model} should strip effort`).toBeUndefined();
    }
  });

  it("leaves non-haiku models untouched", () => {
    const body = {
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    };
    const out = normalizeClaudePassthrough(body, "claude-sonnet-4-6");
    expect(out.thinking).toEqual({ type: "adaptive" });
    expect(out.output_config).toEqual({ effort: "medium" });
  });

  it("retains non-effort output configuration on old Haiku", () => {
    const body = { thinking: { type: "adaptive" }, output_config: { effort: "low", format: { type: "json_schema" } } };
    const out = normalizeClaudePassthrough(body, "claude-haiku-4-5");
    expect(out.output_config).toEqual({ format: { type: "json_schema" } });
  });

  it("keeps the forced-tool-choice guard for adaptive Haiku", () => {
    const body = { thinking: { type: "adaptive" }, tool_choice: { type: "tool", name: "lookup" } };
    const out = normalizeClaudePassthrough(body, "claude-haiku-5-5");
    expect(out.thinking.type).toBe("adaptive");
    expect(out.tool_choice).toEqual({ type: "auto" });
  });
});

describe("OpenAI → Claude translated path — Haiku thinking shape (#1367)", () => {
  const translate = (model) =>
    translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      model,
      { model, reasoning_effort: "high", messages: [{ role: "user", content: "hi" }] },
      true,
      null,
      "claude",
      null,
      [],
      null,
      null,
      null,
    );

  it.each(["claude-haiku-5-5", "claude-haiku-5.5", "claude-5-5-haiku-20261001"])(
    "%s resolves to adaptive capability and emits adaptive thinking",
    (model) => {
      expect(getCapabilitiesForModel("claude", model).thinkingFormat).toBe("claude-adaptive");
      const out = translate(model);
      expect(out.thinking).toEqual(expect.objectContaining({ type: "adaptive" }));
      expect(out.thinking.budget_tokens).toBeUndefined();
      expect(out.output_config?.effort).toBeDefined();
    },
  );

  it.each(["claude-haiku-4-5", "claude-3-5-haiku-20241022", "claude-haiku-latest"])(
    "%s keeps budget thinking",
    (model) => {
      expect(getCapabilitiesForModel("claude", model).thinkingFormat).toBe("claude-budget");
      const out = translate(model);
      expect(out.thinking).toEqual(expect.objectContaining({ type: "enabled" }));
      expect(out.thinking.budget_tokens).toBeGreaterThan(0);
      expect(out.output_config?.effort).toBeUndefined();
    },
  );

  it("existing adaptive model (claude-sonnet-4-6) stays adaptive", () => {
    const out = translate("claude-sonnet-4-6");
    expect(out.thinking).toEqual(expect.objectContaining({ type: "adaptive" }));
    expect(out.output_config?.effort).toBeDefined();
  });
});
