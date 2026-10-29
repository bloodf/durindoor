import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

// #1329 / #1089: Chat→Responses tool_choice allowlist.
const baseTools = [{
  type: OPENAI_BLOCK.FUNCTION,
  function: {
    name: "ns.search",
    description: "Search",
    parameters: { type: "object", properties: { q: { type: "string" } } },
  },
}];

const chat = (extra = {}) => ({
  messages: [{ role: ROLE.USER, content: "Search" }],
  tools: baseTools,
  ...extra,
});

const toResponses = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", structuredClone(body), false);

const longName = `tool_${"x".repeat(135)}`;
const padded = "  ns.search  ";

describe("#1329 Chat tool_choice to Responses", () => {
  it.each([
    // Valid strings
    { case: "string auto", extra: { tool_choice: "auto" }, expected: "auto" },
    { case: "string none", extra: { tool_choice: "none" }, expected: "none" },
    { case: "string required", extra: { tool_choice: "required" }, expected: "required" },
    // Valid named function / custom
    {
      case: "named function",
      extra: { tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } } },
      expected: { type: OPENAI_BLOCK.FUNCTION, name: "ns.search" },
    },
    {
      case: "named custom",
      extra: { tool_choice: { type: "custom", custom: { name: "  code_exec  " } } },
      expected: { type: "custom", name: "code_exec" },
    },
    {
      case: "padded function name aligns with tools",
      extra: {
        tools: [{
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: padded, description: "Search", parameters: { type: "object", properties: { q: { type: "string" } } } },
        }],
        tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: padded } },
      },
      expected: { type: OPENAI_BLOCK.FUNCTION, name: "ns.search" },
      matchToolsName: true,
    },
    {
      case: "140-char function name aligns with tools",
      extra: {
        tools: [{
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: longName, description: "Long", parameters: { type: "object", properties: {} } },
        }],
        tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: longName } },
      },
      expected: { type: OPENAI_BLOCK.FUNCTION, name: longName.slice(0, 128) },
      matchToolsName: true,
    },
    // Valid allowed_tools
    {
      case: "allowed_tools with normalized names",
      extra: {
        tools: [
          { type: OPENAI_BLOCK.FUNCTION, function: { name: "  get_weather  ", parameters: { type: "object", properties: {} } } },
          { type: OPENAI_BLOCK.FUNCTION, function: { name: "search_docs", parameters: { type: "object", properties: {} } } },
        ],
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: {
            mode: "auto",
            tools: [
              { type: OPENAI_BLOCK.FUNCTION, function: { name: "  get_weather  " } },
              { type: OPENAI_BLOCK.FUNCTION, function: { name: "search_docs" } },
            ],
          },
        },
      },
      expected: {
        type: "allowed_tools",
        mode: "auto",
        tools: [
          { type: OPENAI_BLOCK.FUNCTION, name: "get_weather" },
          { type: OPENAI_BLOCK.FUNCTION, name: "search_docs" },
        ],
      },
      matchToolsName: true,
    },
    {
      case: "allowed_tools skips null entry keeps sibling",
      extra: {
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: {
            mode: "auto",
            tools: [null, { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } }],
          },
        },
      },
      expected: {
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "ns.search" }],
      },
    },
    // Drops — no tools / empty / filtered
    {
      case: "required with no tools",
      body: { messages: [{ role: ROLE.USER, content: "Search" }], tool_choice: "required" },
      expected: undefined,
      expectTools: undefined,
    },
    {
      case: "required with tools:[]",
      body: { messages: [{ role: ROLE.USER, content: "Search" }], tools: [], tool_choice: "required" },
      expected: undefined,
      expectTools: [],
    },
    {
      case: "auto when every tool filtered out",
      extra: {
        tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "   ", parameters: { type: "object" } } }],
        tool_choice: "auto",
      },
      expected: undefined,
      expectTools: [],
    },
    // Drops — null / arrays / primitives
    { case: "null with tools", extra: { tool_choice: null }, expected: undefined },
    {
      case: "null without tools",
      body: { messages: [{ role: ROLE.USER, content: "Search" }], tool_choice: null },
      expected: undefined,
      expectTools: undefined,
    },
    { case: "array tool_choice", extra: { tool_choice: [] }, expected: undefined },
    { case: "number 5", extra: { tool_choice: 5 }, expected: undefined },
    { case: "boolean true", extra: { tool_choice: true }, expected: undefined },
    { case: "boolean false", extra: { tool_choice: false }, expected: undefined },
    // Drops — invalid strings / object types (review 5692160242)
    { case: "empty string", extra: { tool_choice: "" }, expected: undefined },
    { case: "string foo", extra: { tool_choice: "foo" }, expected: undefined },
    { case: "object with no type", extra: { tool_choice: {} }, expected: undefined },
    { case: "object with empty type", extra: { tool_choice: { type: "" } }, expected: undefined },
    { case: "object with non-string type", extra: { tool_choice: { type: 5 } }, expected: undefined },
    { case: "hosted web_search type", extra: { tool_choice: { type: "web_search" } }, expected: undefined },
    // Drops — blank names / empty allowed_tools
    {
      case: "blank function name",
      extra: { tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "   " } } },
      expected: undefined,
    },
    {
      case: "blank custom name",
      extra: { tool_choice: { type: "custom", custom: { name: " " } } },
      expected: undefined,
    },
    {
      case: "allowed_tools all nameless",
      extra: {
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: {
            mode: "required",
            tools: [
              { type: OPENAI_BLOCK.FUNCTION, function: { name: "  " } },
              { type: OPENAI_BLOCK.FUNCTION, function: { name: "" } },
            ],
          },
        },
      },
      expected: undefined,
    },
    {
      case: "allowed_tools all null entries",
      extra: {
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: { mode: "required", tools: [null, null] },
        },
      },
      expected: undefined,
    },
    {
      case: "allowed_tools missing mode",
      extra: {
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: {
            tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } }],
          },
        },
      },
      expected: undefined,
    },
    {
      case: "allowed_tools invalid mode",
      extra: {
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: {
            mode: "maybe",
            tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } }],
          },
        },
      },
      expected: undefined,
    },
  ])("$case", ({ extra, body, expected, expectTools, matchToolsName }) => {
    const out = toResponses(body ?? chat(extra ?? {}));
    expect(out.tool_choice).toEqual(expected);
    if (expectTools !== undefined) expect(out.tools).toEqual(expectTools);
    if (matchToolsName && out.tool_choice?.name != null) {
      expect(out.tool_choice.name).toBe(out.tools[0].name);
    }
    if (matchToolsName && out.tool_choice?.tools?.[0]?.name != null) {
      expect(out.tool_choice.tools[0].name).toBe(out.tools[0].name);
    }
  });

  it("keeps parallel_tool_calls alongside a valid tool_choice", () => {
    expect(toResponses(chat({ tool_choice: "auto", parallel_tool_calls: false })).parallel_tool_calls).toBe(false);
    expect(toResponses(chat({ tool_choice: "auto", parallel_tool_calls: true })).parallel_tool_calls).toBe(true);
  });

  // Custom declaration lowering is follow-up #1344; this PR must not change it.
  it("passes Chat custom tool declarations through unchanged", () => {
    const customTool = {
      type: "custom",
      custom: { name: "code_exec", description: "Run code", format: { type: "text" } },
    };
    const out = toResponses({
      messages: [{ role: ROLE.USER, content: "Run" }],
      tools: [customTool],
      tool_choice: "auto",
    });
    expect(out.tools).toEqual([customTool]);
    expect(out.tool_choice).toBe("auto");
  });
});
