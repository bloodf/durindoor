import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE } from "../../open-sse/translator/schema/index.js";

describe("Claude system effort directives", () => {
  const body = () => ({ output_config: { effort: "low" }, messages: [
    { role: ROLE.SYSTEM, content: [], output_config: { effort: "medium" } },
    { role: ROLE.SYSTEM, content: [], output_config: { effort: " High " } },
    { role: ROLE.USER, content: "hello" },
  ] });
  it("uses the last directive in direct and pipeline translation", () => {
    expect(claudeToOpenAIRequest("gpt-5", body(), false).reasoning_effort).toBe("high");
    expect(translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gpt-5", body(), false, {}, "openai").reasoning_effort).toBe("high");
  });
  it("ignores empty directives and keeps the top-level effort", () => {
    const request = body();
    request.messages = [{ role: ROLE.SYSTEM, content: [], output_config: { effort: "  " } }];
    expect(claudeToOpenAIRequest("gpt-5", request, false).reasoning_effort).toBe("low");
  });
});
