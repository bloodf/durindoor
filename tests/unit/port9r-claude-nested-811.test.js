import { describe, expect, it } from "vitest";
import { decloakToolNames } from "../../open-sse/utils/claudeCloaking.js";

describe("Claude tool names in response envelopes", () => {
  it("restores mapped tool names inside nested message histories", () => {
    const input = { messages: [{ content: [{ type: "tool_use", name: "exec_ide", id: "1" }] }] };
    expect(decloakToolNames(input, new Map([["exec_ide", "exec"]]))).toEqual({
      messages: [{ content: [{ type: "tool_use", name: "exec", id: "1" }] }],
    });
  });
  it("preserves a legitimate suffix on uncloaked requests", () => {
    const input = { content: [{ type: "tool_use", name: "exec_ide" }] };
    expect(decloakToolNames(input, null)).toEqual(input);
  });
});
