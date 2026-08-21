// decolua/9router#3342 — CodeBuddy CN must report and independently apply
// its agent-identity and configurable system-prompt length rules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const ENV_KEY = "CODEBUDDY_SYSTEM_PROMPT_MAX_LEN";
const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const IDENTITY_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";
const LONG_PROJECT_PROMPT = `Project conventions. ${"Prefer small, focused functions and explicit names. ".repeat(60)}`;

function transform(body, executor = new CodeBuddyExecutor()) {
  return executor.transformRequest("glm-5.2", body, false, {});
}

describe("CodeBuddyExecutor system-prompt filter (#3342)", () => {
  let warn;

  beforeEach(() => {
    delete process.env[ENV_KEY];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    warn.mockRestore();
  });

  it("replaces a system prompt above the configured threshold and names the LENGTH rule", () => {
    process.env[ENV_KEY] = "100";

    const output = transform({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });

    expect(output.messages[0].content).toBe(NEUTRAL_PROMPT);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("LENGTH"));
    expect(warn.mock.calls[0][0]).toContain(ENV_KEY);
  });

  it("disables only length matching when the threshold is zero", () => {
    process.env[ENV_KEY] = "0";

    const output = transform({
      messages: [
        { role: "system", content: LONG_PROJECT_PROMPT },
        { role: "system", content: IDENTITY_PROMPT },
      ],
    });

    expect(output.messages[0].content).toBe(LONG_PROJECT_PROMPT);
    expect(output.messages[1].content).toBe(NEUTRAL_PROMPT);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("IDENTITY"));
  });

  it.each(["0x10", "1e3", "+5", "not-a-length"])(
    "falls back to 2000 for invalid threshold %s",
    (threshold) => {
      process.env[ENV_KEY] = threshold;
      expect(LONG_PROJECT_PROMPT.length).toBeGreaterThan(2000);

      const output = transform({ messages: [{ role: "system", content: LONG_PROJECT_PROMPT }] });

      expect(output.messages[0].content).toBe(NEUTRAL_PROMPT);
      expect(warn.mock.calls[0][0]).toContain("2000");
    },
  );

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

  it("preserves typed text-block shape when replacing a prompt", () => {
    const output = transform({
      messages: [{ role: "system", content: [{ type: "text", text: IDENTITY_PROMPT }] }],
    });

    expect(output.messages[0].content).toEqual([{ type: "text", text: NEUTRAL_PROMPT }]);
  });
});
