import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Input from "../../src/shared/components/Input.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

describe("issue 2590 regressions", () => {
  it("emits held inline text before a subsequent tool block", () => {
    const state = { toolCalls: new Map(), provider: "minimax", requestedModel: "MiniMax-M3" };
    const chunk = (delta) => ({ id: "chatcmpl-test1234", choices: [{ delta }] });
    const events = [
      ...openaiToClaudeResponse(chunk({ content: "before <th" }), state),
      ...openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{}" } }] }), state),
    ];
    const text = events.findIndex((event) => event.delta?.text?.includes("<th"));
    const tool = events.findIndex((event) => event.content_block?.type === "tool_use");
    expect(text).toBeGreaterThanOrEqual(0);
    expect(tool).toBeGreaterThan(text);
  });

  it("keeps the sticky limit name and exposes the hint as a description", () => {
    const html = renderToStaticMarkup(createElement(Input, { id: "sticky", label: "Sticky Limit", hint: "Calls per account before switching.", type: "number" }));
    expect(html).toContain('for="sticky"');
    expect(html).toContain('aria-describedby="sticky-hint"');
    expect(html).toContain('id="sticky-hint"');
    expect(html).not.toContain('aria-labelledby="sticky-hint"');
  });
});
