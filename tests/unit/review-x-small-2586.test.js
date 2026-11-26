import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Input from "../../src/shared/components/Input.js";
import { normalizeGrokCliHistory } from "../../open-sse/executors/grokCliResponsesCompat.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

const call = (id) => ({ type: "function_call", call_id: id, name: "lookup", arguments: "{}" });
const output = (id, value) => ({ type: "function_call_output", call_id: id, output: value });

describe("issue 2590 regressions", () => {
  it("answers every duplicate call before the next turn", () => {
    const next = { type: "message", role: "user", content: "next" };
    const result = normalizeGrokCliHistory([call("a"), output("a", "done"), call("a"), next]);
    expect(result).toEqual([call("a"), output("a", "done"), call("a"), output("a", expect.stringContaining("was not executed")), next]);
    expect(normalizeGrokCliHistory([call("a"), call("a"), output("a", "first"), output("a", "second")])).toEqual([
      call("a"), call("a"), output("a", "first"), output("a", "second"),
    ]);
  });

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
