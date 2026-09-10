// decolua/9router#3823 — CodeBuddy CN replaces coding-agent identities while
// preserving legitimate system prompts regardless of their length.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const IDENTITY_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";
const LONG_PROJECT_PROMPT = `Project conventions. ${"Prefer small, focused functions and explicit names. ".repeat(60)}`;
const SHORT_PROJECT_PROMPT = "Use explicit names and focused functions.";

function transform(body, executor = new CodeBuddyExecutor()) {
  return executor.transformRequest("glm-5.2", body, false, {});
}

describe("CodeBuddyExecutor system-prompt identity filter (#3823)", () => {
  let warn;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it("preserves long legitimate string and typed-block system prompts byte-for-byte", () => {
    const typedContent = [{ type: "text", text: LONG_PROJECT_PROMPT }];

    const output = transform({
      messages: [
        { role: "system", content: LONG_PROJECT_PROMPT },
        { role: "system", content: typedContent },
      ],
    });

    expect(output.stream).toBe(true);
    expect(output.messages[0].content).toBe(LONG_PROJECT_PROMPT);
    expect(output.messages[1].content).toEqual(typedContent);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores the retired length environment setting", () => {
    vi.stubEnv("CODEBUDDY_SYSTEM_PROMPT_MAX_LEN", "100");

    const output = transform({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });

    expect(output.stream).toBe(true);
    expect(output.messages[0].content).toBe(LONG_PROJECT_PROMPT);
    expect(warn).not.toHaveBeenCalled();
  });

  it("replaces actual identity markers in string and typed-block system prompts", () => {
    const output = transform({
      messages: [
        { role: "system", content: IDENTITY_PROMPT },
        { role: "system", content: [{ type: "text", text: IDENTITY_PROMPT }] },
        { role: "system", content: SHORT_PROJECT_PROMPT },
      ],
    });

    expect(output.stream).toBe(true);
    expect(output.messages[0].content).toBe(NEUTRAL_PROMPT);
    expect(output.messages[1].content).toEqual([{ type: "text", text: NEUTRAL_PROMPT }]);
    expect(output.messages[2].content).toBe(SHORT_PROJECT_PROMPT);
  });

  it("never rewrites non-system messages", () => {
    const output = transform({
      messages: [
        { role: "user", content: LONG_PROJECT_PROMPT },
        { role: "assistant", content: IDENTITY_PROMPT },
      ],
    });

    expect(output.messages).toEqual([
      { role: "user", content: LONG_PROJECT_PROMPT },
      { role: "assistant", content: IDENTITY_PROMPT },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("filters after and preserves the superclass transformation", () => {
    const executor = new CodeBuddyExecutor();
    executor.config = { ...executor.config, requestDefaults: { maxTokens: 1234 } };

    const output = transform(
      { messages: [{ role: "system", content: IDENTITY_PROMPT }] },
      executor,
    );

    expect(output.max_tokens).toBe(1234);
    expect(output.messages[0].content).toBe(NEUTRAL_PROMPT);
  });

});
