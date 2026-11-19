import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";

describe("Antigravity OpenCode identity rewrite boundaries", () => {
  const rewrite = (text) => text.replace(ANTIGRAVITY_PROMPT_REWRITES[0].from, ANTIGRAVITY_PROMPT_REWRITES[0].to);

  it("rewrites standalone identity while preserving paths, URLs, packages, and identifiers", () => {
    expect(rewrite("OpenCode and opencode")).toBe("Antigravity and antigravity");
    for (const value of ["/tmp/opencode-123", "~/.config/opencode/config.json", "C:\\opencode\\file", "https://opencode.ai", "@scope/opencode", "my_opencode_tool"]) {
      expect(rewrite(value)).toBe(value);
    }
  });
});
