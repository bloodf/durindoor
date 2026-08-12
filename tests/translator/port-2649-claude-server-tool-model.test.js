import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

describe("port #2649: Claude server-tool model normalization", () => {
  it("strips the provider prefix from a nested tool model without changing other fields", () => {
    const body = {
      model: "cc/claude-opus-4-8",
      tools: [{
        type: "advisor_20260301",
        name: "advisor",
        model: "cc/claude-opus-4-8",
        input_schema: { type: "object", required: ["question"] },
        cache_control: { type: "ephemeral" },
      }],
    };

    expect(normalizeClaudePassthrough(body)).toEqual({
      model: "cc/claude-opus-4-8",
      tools: [{
        type: "advisor_20260301",
        name: "advisor",
        model: "claude-opus-4-8",
        input_schema: { type: "object", required: ["question"] },
        cache_control: { type: "ephemeral" },
      }],
    });
  });

  it("strips the claude provider prefix from a nested tool model", () => {
    const body = {
      tools: [{
        type: "advisor_20260301",
        model: "claude/claude-opus-4-8",
      }],
    };

    expect(normalizeClaudePassthrough(body).tools[0].model).toBe("claude-opus-4-8");
  });

  it.each([
    "claude-opus-4-8",
    "anthropic/claude-opus-4-8",
  ])("leaves unknown nested tool model prefix unchanged: %s", (model) => {
    const body = {
      tools: [{
        type: "advisor_20260301",
        model,
      }],
    };

    expect(normalizeClaudePassthrough(body).tools[0].model).toBe(model);
  });
});
