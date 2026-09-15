/**
 * Anthropic rejects forced tool choice while thinking is on:
 *
 *   tool_choice: type "tool" and "any" are not supported for this model.
 *
 * Forced choices prefill the assistant turn, which is incompatible with the
 * thinking/tool-use response format. Only "auto" and "none" are accepted.
 *
 * This is unrecoverable for an adaptive-thinking model like Fable 5.1, whose
 * thinking cannot be turned off (`thinkingCanDisable: false`): every agentic
 * request that forces a tool is a hard 400 with no client-side workaround.
 */
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const withTools = (overrides) => ({
  model: "claude-fable-5-1",
  max_tokens: 4096,
  messages: [{ role: "user", content: "search the repo" }],
  tools: [{ name: "grep", input_schema: { type: "object" } }],
  ...overrides,
});

describe("forced tool_choice against a thinking model", () => {
  it("downgrades `any` to `auto` when thinking is enabled", () => {
    const body = normalizeClaudePassthrough(
      withTools({ tool_choice: { type: "any" }, thinking: { type: "enabled", budget_tokens: 10000 } }),
      "claude-fable-5-1",
    );
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("downgrades `tool` to `auto` under adaptive thinking", () => {
    const body = normalizeClaudePassthrough(
      withTools({ tool_choice: { type: "tool", name: "grep" }, thinking: { type: "adaptive" } }),
      "claude-fable-5-1",
    );
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("carries disable_parallel_tool_use across the downgrade", () => {
    // The caller asked for exactly one tool call. Dropping that flag silently
    // re-enables parallel calls and changes how the response must be handled.
    const body = normalizeClaudePassthrough(
      withTools({
        tool_choice: { type: "any", disable_parallel_tool_use: true },
        thinking: { type: "enabled", budget_tokens: 10000 },
      }),
      "claude-fable-5-1",
    );
    expect(body.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  });

  it("leaves `auto` and `none` untouched", () => {
    for (const choice of [{ type: "auto" }, { type: "none" }]) {
      const body = normalizeClaudePassthrough(
        withTools({ tool_choice: { ...choice }, thinking: { type: "enabled", budget_tokens: 10000 } }),
        "claude-fable-5-1",
      );
      expect(body.tool_choice).toEqual(choice);
    }
  });

  it("keeps a forced choice when thinking is off", () => {
    // Without thinking the constraint does not apply, and forcing a tool is a
    // legitimate request the caller relies on.
    const body = normalizeClaudePassthrough(
      withTools({ tool_choice: { type: "any" } }),
      "claude-sonnet-4-5",
    );
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  it("keeps a forced choice on a model whose thinking was downgraded away", () => {
    // Haiku rejects adaptive thinking, so the sanitizer rewrites it to enabled
    // — which still conflicts. The check must run against the final thinking
    // state, not the one the client sent.
    const body = normalizeClaudePassthrough(
      withTools({ model: "claude-haiku-4-5", tool_choice: { type: "tool", name: "grep" }, thinking: { type: "adaptive" } }),
      "claude-haiku-4-5",
    );
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("does nothing when no tools are supplied", () => {
    const body = normalizeClaudePassthrough(
      { model: "claude-fable-5-1", max_tokens: 4096, messages: [{ role: "user", content: "hi" }], thinking: { type: "adaptive" } },
      "claude-fable-5-1",
    );
    expect(body.tool_choice).toBeUndefined();
  });
});

describe("OpenAI client → Claude, the path OMP actually takes", () => {
  // This is the reported failure. OMP speaks OpenAI, so the request is
  // TRANSLATED rather than passed through, and convertOpenAIToolChoice turns
  // tool_choice:"required" into Anthropic's {type:"any"} — the exact shape
  // Anthropic refuses once thinking is on. Guarding only the passthrough path
  // would leave this 400 in place.
  const openAiBody = (toolChoice) => ({
    model: "claude-fable-5-1",
    max_tokens: 4096,
    messages: [{ role: "user", content: "search the repo" }],
    tools: [{ type: "function", function: { name: "grep", parameters: { type: "object" } } }],
    tool_choice: toolChoice,
  });

  const translate = (body) => translateRequest(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    "claude-fable-5-1",
    body,
    true,
    null,
    "claude",
    null,
    [],
    null,
    "openai",
    { capabilityModel: "claude-fable-5-1" },
  );

  it('downgrades OpenAI "required" instead of sending the rejected {type:"any"}', () => {
    const translated = translate(openAiBody("required"));
    expect(translated.tool_choice).toEqual({ type: "auto" });
  });

  it("downgrades a named OpenAI function choice", () => {
    const translated = translate(openAiBody({ type: "function", function: { name: "grep" } }));
    expect(translated.tool_choice?.type).toBe("auto");
    expect(translated.tool_choice).not.toHaveProperty("name");
  });

  it('leaves "auto" and "none" alone', () => {
    expect(translate(openAiBody("auto")).tool_choice).toEqual({ type: "auto" });
    expect(translate(openAiBody("none")).tool_choice).toEqual({ type: "none" });
  });
});
