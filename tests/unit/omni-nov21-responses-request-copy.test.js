import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const params = { type: "object", properties: {} };
const flat = (name) => ({ type: "function", name, parameters: params });
const ns = (name, members) => ({
  type: "namespace",
  name,
  tools: members.map((member) => ({ type: "function", name: member, parameters: params }))
});
const chatNames = (body) =>
  openaiResponsesToOpenAIRequest("gpt-5", body, false, null).tools.map((tool) => tool.function.name);
const wireNames = (body) =>
  translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-5", body, false, null, "openai").tools.map(
    (tool) => tool.function.name
  );

// ── #20241 namespace members vs flat tools ────────────────────────────────────────────────
// DurinDoor has no "explicit flat tool shadows a namespace member" filter, so a member can
// never be dropped for sharing only a leaf name. A member whose final wire name equals a
// flat tool's is kept distinct by the alias allocator instead of duplicating it.
describe("#20241 Responses namespace member vs flat tool names", () => {
  it("keeps distinct `search` and `mcp__github.search`", () => {
    const body = { input: "x", tools: [flat("search"), ns("mcp__github", ["search"])] };
    expect(chatNames(body).sort()).toEqual(["mcp__github.search", "search"]);
    const wire = wireNames(structuredClone(body));
    expect(wire).toHaveLength(2);
    expect(new Set(wire).size).toBe(2);
  });

  it("applies the same rule to additional_tools envelopes", () => {
    const body = {
      input: [
        { type: "additional_tools", tools: [flat("search")] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }
      ],
      tools: [ns("mcp__github", ["search"])]
    };
    expect(chatNames(body).sort()).toEqual(["mcp__github.search", "search"]);
    expect(new Set(wireNames(structuredClone(body))).size).toBe(2);
  });

  it("never sends two tools with the same wire name when a flat tool matches the member's wire name", () => {
    const body = { input: "x", tools: [flat("mcp__github__search"), ns("mcp__github", ["search"])] };
    const wire = wireNames(body);
    expect(wire).toHaveLength(2);
    expect(new Set(wire).size).toBe(2);
    expect(wire).toContain("mcp__github__search");
  });

  it("keeps `functions.exec` apart from a flat `exec` on the wire", () => {
    const wire = wireNames({ input: "x", tools: [flat("exec"), ns("functions", ["exec"])] });
    expect(wire).toHaveLength(2);
    expect(new Set(wire).size).toBe(2);
    expect(wire).toContain("exec");
  });
});

// ── #20245 translateRequest must not edit the caller's messages ───────────────────────────
function callerBody() {
  return {
    model: "m",
    stream: false,
    messages: [
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: "a",
        reasoning_content: "KEEP-ME",
        reasoning: "KEEP-ME",
        tool_calls: [{ id: "", function: { name: "f", arguments: "" } }]
      },
      { role: "tool", content: "tool output" },
      { role: "user", content: "next" }
    ]
  };
}

describe("#20245 translateRequest keeps the caller's messages and tool calls", () => {
  for (const [label, target, provider, model] of [
    ["Chat -> Chat", FORMATS.OPENAI, "openai", "gpt-4o"],
    ["Chat -> Claude", FORMATS.CLAUDE, "anthropic", "claude-sonnet-4-5"],
    ["Chat -> Gemini", FORMATS.GEMINI, "gemini", "gemini-2.5-pro"],
    ["Chat -> Responses", FORMATS.OPENAI_RESPONSES, "openai", "gpt-5"]
  ]) {
    it(`${label}: caller messages and nested tool calls stay deeply unchanged`, () => {
      const input = callerBody();
      const before = structuredClone(input);
      translateRequest(FORMATS.OPENAI, target, model, input, false, null, provider);
      expect(input).toEqual(before);
    });
  }

  it("content-type stripping does not edit the caller's message content", () => {
    const input = {
      model: "m",
      messages: [{ role: "user", content: [{ type: "text", text: "t" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }]
    };
    const before = structuredClone(input);
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", input, false, null, "openai", null, ["image"]);
    expect(input).toEqual(before);
    expect(JSON.stringify(out.messages)).not.toContain("image_url");
  });

  it("two sequential translations receive the same original body", () => {
    const shared = callerBody();
    const before = structuredClone(shared);
    const first = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", { ...shared }, false, null, "openai");
    expect(shared).toEqual(before);
    const second = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", { ...shared }, false, null, "openai");
    expect(second.messages).toEqual(first.messages);
    expect(shared.messages[1].tool_calls[0].id).toBe("");
    expect(shared.messages[1].tool_calls[0].function.arguments).toBe("");
  });

  it("a displaced tool result moves in the output, not in the caller's array", () => {
    const input = {
      model: "m",
      messages: [
        { role: "user", content: "u" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }] },
        { role: "user", content: "interleaved" },
        { role: "tool", tool_call_id: "call_1", content: "late result" }
      ]
    };
    const order = input.messages.map((m) => m.role).join(",");
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", input, false, null, "openai");
    expect(input.messages.map((m) => m.role).join(",")).toBe(order);
    expect(out.messages.map((m) => m.role).join(",")).toBe("user,assistant,tool,user");
  });

  it("the translated output still carries the normalized values and unowned body fields", () => {
    const input = { ...callerBody(), metadata: { keep: true }, temperature: 0.3 };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", input, false, null, "openai");
    const call = out.messages[1].tool_calls[0];
    expect(call.id).toMatch(/\S/);
    expect(call.function.arguments).toBe("{}");
    expect(out.temperature).toBe(0.3);
    expect(out.metadata).toEqual({ keep: true });
  });

  it("Claude system/tool rewrites still produce the existing wire format", () => {
    const input = {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_time", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "noon" }
      ],
      tools: [{ type: "function", function: { name: "get_time", parameters: params } }]
    };
    const before = structuredClone(input);
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", input, false, null, "anthropic");
    expect(input).toEqual(before);
    expect(JSON.stringify(out.system)).toContain("be brief");
    expect(out.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use" && b.name === "get_time"))).toBe(true);
    expect(out.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result" && b.tool_use_id === "call_1"))).toBe(true);
    expect(out.tools.map((tool) => tool.name)).toContain("get_time");
  });
});
