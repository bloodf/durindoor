import { describe, expect, it } from "vitest";

import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";
import { convertGrokBuildCustomTools } from "../../open-sse/executors/grokCliCustomTools.js";

const transform = (body) =>
  new GrokCliExecutor().transformRequest("grok-4.5", body, true, { connectionId: "c-2647" }, {});
const call = (id, extra = {}) => ({ type: "function_call", call_id: id, name: "lookup", arguments: "{}", ...extra });
const output = (id, value) => ({ type: "function_call_output", call_id: id, output: value });
const user = (text) => ({ type: "message", role: "user", content: text });

describe("Grok CLI Responses history and tools (upstream decolua/9router#2647)", () => {
  it("maps developer messages to system and strips client-internal metadata", () => {
    const out = transform({
      input: [
        { type: "message", role: "developer", content: "rules", internal_chat_message_metadata_passthrough: { turn: 1 } },
        user("hi"),
      ],
    });

    expect(out.input[0]).toEqual({ type: "message", role: "system", content: "rules" });
  });

  it("answers duplicate and dangling calls in order", () => {
    const out = transform({
      input: [call("a"), call("a"), output("a", "first"), output("a", "second"), call("b"), user("next")],
    });

    expect(out.input.map((item) => [item.type, item.call_id, item.output])).toEqual([
      ["function_call", "a", undefined],
      ["function_call", "a", undefined],
      ["function_call_output", "a", "first"],
      ["function_call_output", "a", "second"],
      ["function_call", "b", undefined],
      ["function_call_output", "b", expect.stringContaining("was not executed")],
      ["message", undefined, undefined],
    ]);
  });

  it("keeps a real output separated from its call by another item", () => {
    const out = transform({
      input: [call("a"), { type: "message", role: "assistant", content: "working" }, output("a", "done")],
    });

    expect(out.input.filter((item) => item.type === "function_call_output")).toEqual([output("a", "done")]);
  });

  it("folds an orphan tool output into user text instead of sending an unpaired item", () => {
    const out = transform({ input: [output("gone", "42"), user("continue")] });

    expect(out.input.some((item) => item.type === "function_call_output")).toBe(false);
    expect(out.input[0]).toMatchObject({ type: "message", role: "user" });
    expect(out.input[0].content[0].text).toContain("42");
  });

  it("sends valid JSON arguments and string or typed-content outputs", () => {
    const typed = [{ type: "input_text", text: "part" }];
    const out = transform({
      input: [
        call("a", { arguments: { q: 1 } }), output("a", null),
        call("b", { arguments: "{broken" }), output("b", { ok: true }),
        call("c"), output("c", typed),
        call("d"), output("d", [1, 2]),
      ],
    });
    const byType = (type) => out.input.filter((item) => item.type === type);

    expect(byType("function_call").map((item) => item.arguments)).toEqual(['{"q":1}', "{}", "{}", "{}"]);
    expect(byType("function_call_output").map((item) => item.output)).toEqual(["null", '{"ok":true}', typed, "[1,2]"]);
  });

  it("preserves native x_search history", () => {
    const native = { type: "custom_tool_call", id: "ctc_1", call_id: "xs_call-1", name: "x_keyword_search", input: "q" };

    const { body } = convertGrokBuildCustomTools({ input: [native] });

    expect(body.input).toEqual([native]);
  });

  it("keeps hosted and explicitly selected tools when capping at 200", () => {
    const functions = Array.from({ length: 205 }, (_, i) => ({ type: "function", name: `tool_${i}` }));
    const out = transform({
      input: "hi",
      tools: [...functions, { type: "web_search" }],
      tool_choice: { type: "function", name: "tool_204" },
    });

    expect(out.tools).toHaveLength(200);
    expect(out.tools.map((tool) => tool.type === "web_search" ? "web_search" : tool.name))
      .toEqual(expect.arrayContaining(["web_search", "tool_204", "tool_0"]));
    expect(out.tool_choice).toEqual({ type: "function", name: "tool_204" });
  });

  it("drops duplicate hosted search tools and functions that collide with them", () => {
    const out = transform({
      input: "hi",
      tools: [{ type: "web_search" }, { type: "web_search" }, { type: "function", name: "web_search" }, { type: "mcp", server_label: "a" }, { type: "mcp", server_label: "b" }],
    });

    expect(out.tools.map((tool) => tool.server_label || tool.type)).toEqual(["web_search", "a", "b"]);
  });

  it.each([
    [{ type: "custom", name: "lookup" }, { type: "function", name: "lookup" }],
    [{ type: "function", function: { name: "lookup" } }, { type: "function", name: "lookup" }],
    [{ type: "custom", name: "missing" }, undefined],
  ])("normalizes tool_choice %j against the final tools", (choice, expected) => {
    const out = transform({ input: "hi", tools: [{ type: "function", name: "lookup" }], tool_choice: choice });

    expect(out.tool_choice).toEqual(expected);
  });

  it("drops tool_choice when no tools remain", () => {
    expect(transform({ input: "hi", tool_choice: "required" }).tool_choice).toBeUndefined();
  });

  it("sends the max effort alias as xhigh", () => {
    expect(transform({ input: "hi", reasoning: { effort: "max" } }).reasoning.effort).toBe("xhigh");
  });
});
