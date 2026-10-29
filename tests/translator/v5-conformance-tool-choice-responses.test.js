import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

// #1329 / #1089: Chat→Responses must preserve tool_choice (string and named forms).
const chat = (extra = {}) => ({
  messages: [{ role: ROLE.USER, content: "Search" }],
  tools: [{
    type: OPENAI_BLOCK.FUNCTION,
    function: {
      name: "ns.search",
      description: "Search",
      parameters: { type: "object", properties: { q: { type: "string" } } },
    },
  }],
  ...extra,
});

const toResponses = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", structuredClone(body), false);

describe("#1329 Chat tool_choice to Responses", () => {
  it.each(["auto", "none", "required"])("preserves tool_choice %s on Chat to Responses", (choice) => {
    const out = toResponses(chat({ tool_choice: choice }));
    expect(out.tool_choice).toBe(choice);
  });

  it("preserves named tool_choice on Chat to Responses", () => {
    const out = toResponses(chat({
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } },
    }));
    expect(out.tool_choice).toEqual({ type: OPENAI_BLOCK.FUNCTION, name: "ns.search" });
  });

  it("keeps parallel_tool_calls alongside tool_choice", () => {
    expect(toResponses(chat({ tool_choice: "auto", parallel_tool_calls: false })).parallel_tool_calls).toBe(false);
    expect(toResponses(chat({ tool_choice: "auto", parallel_tool_calls: true })).parallel_tool_calls).toBe(true);
  });

  it("aligns a padded forced name with the declared tool name", () => {
    const padded = "  ns.search  ";
    const out = toResponses(chat({
      tools: [{
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: padded,
          description: "Search",
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      }],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: padded } },
    }));
    expect(out.tools[0].name).toBe("ns.search");
    expect(out.tool_choice.name).toBe(out.tools[0].name);
  });

  it("aligns a 140-character forced name with the declared tool name", () => {
    const longName = `tool_${"x".repeat(135)}`;
    expect(longName.length).toBe(140);
    const out = toResponses(chat({
      tools: [{
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: longName,
          description: "Long",
          parameters: { type: "object", properties: {} },
        },
      }],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: longName } },
    }));
    expect(out.tools[0].name.length).toBe(128);
    expect(out.tool_choice.name).toBe(out.tools[0].name);
  });

  it("lowers Chat allowed_tools to the Responses flat shape with normalized names", () => {
    const out = toResponses(chat({
      tools: [
        {
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: "  get_weather  ", parameters: { type: "object", properties: {} } },
        },
        {
          type: OPENAI_BLOCK.FUNCTION,
          function: { name: "search_docs", parameters: { type: "object", properties: {} } },
        },
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
    }));
    expect(out.tool_choice).toEqual({
      type: "allowed_tools",
      mode: "auto",
      tools: [
        { type: OPENAI_BLOCK.FUNCTION, name: "get_weather" },
        { type: OPENAI_BLOCK.FUNCTION, name: "search_docs" },
      ],
    });
    expect(out.tool_choice.tools[0].name).toBe(out.tools[0].name);
  });

  it("lowers Chat named custom tool_choice to Responses {type,name}", () => {
    const out = toResponses(chat({
      tool_choice: { type: "custom", custom: { name: "  code_exec  " } },
    }));
    expect(out.tool_choice).toEqual({ type: "custom", name: "code_exec" });
  });

  it("drops tool_choice required when no tools are declared", () => {
    const out = toResponses({
      messages: [{ role: ROLE.USER, content: "Search" }],
      tool_choice: "required",
    });
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
  });

  it("drops tool_choice required when tools is an empty array", () => {
    const out = toResponses({
      messages: [{ role: ROLE.USER, content: "Search" }],
      tools: [],
      tool_choice: "required",
    });
    expect(out.tools).toEqual([]);
    expect(out.tool_choice).toBeUndefined();
  });

  it("drops tool_choice auto when every tool declaration is filtered out", () => {
    const out = toResponses(chat({
      tools: [{ type: OPENAI_BLOCK.FUNCTION, function: { name: "   ", parameters: { type: "object" } } }],
      tool_choice: "auto",
    }));
    expect(out.tools).toEqual([]);
    expect(out.tool_choice).toBeUndefined();
  });

  it("drops allowed_tools when every entry is nameless after normalize", () => {
    const out = toResponses(chat({
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
    }));
    expect(out.tools.length).toBeGreaterThan(0);
    expect(out.tool_choice).toBeUndefined();
  });

  it("drops a function tool_choice whose name is blank after normalize", () => {
    const out = toResponses(chat({
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: "   " } },
    }));
    expect(out.tools.length).toBeGreaterThan(0);
    expect(out.tool_choice).toBeUndefined();
  });

  it("drops a custom tool_choice whose name is blank after normalize", () => {
    const out = toResponses(chat({
      tool_choice: { type: "custom", custom: { name: " " } },
    }));
    expect(out.tools.length).toBeGreaterThan(0);
    expect(out.tool_choice).toBeUndefined();
  });

  it("drops tool_choice null when tools are present without throwing", () => {
    expect(() => {
      const out = toResponses(chat({ tool_choice: null }));
      expect(out.tools.length).toBeGreaterThan(0);
      expect(out.tool_choice).toBeUndefined();
    }).not.toThrow();
  });

  it("drops tool_choice null when no tools are present without throwing", () => {
    expect(() => {
      const out = toResponses({
        messages: [{ role: ROLE.USER, content: "Search" }],
        tool_choice: null,
      });
      expect(out.tools).toBeUndefined();
      expect(out.tool_choice).toBeUndefined();
    }).not.toThrow();
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

  it("skips null allowed_tools entries without throwing and keeps valid siblings", () => {
    expect(() => {
      const out = toResponses(chat({
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: {
            mode: "auto",
            tools: [
              null,
              { type: OPENAI_BLOCK.FUNCTION, function: { name: "ns.search" } },
            ],
          },
        },
      }));
      expect(out.tool_choice).toEqual({
        type: "allowed_tools",
        mode: "auto",
        tools: [{ type: OPENAI_BLOCK.FUNCTION, name: "ns.search" }],
      });
    }).not.toThrow();
  });

  it("drops allowed_tools when every entry is null", () => {
    expect(() => {
      const out = toResponses(chat({
        tool_choice: {
          type: "allowed_tools",
          allowed_tools: {
            mode: "required",
            tools: [null, null],
          },
        },
      }));
      expect(out.tool_choice).toBeUndefined();
    }).not.toThrow();
  });

  it.each([5, true])("drops non-string primitive tool_choice %j when tools are present", (choice) => {
    const out = toResponses(chat({ tool_choice: choice }));
    expect(out.tools.length).toBeGreaterThan(0);
    expect(out.tool_choice).toBeUndefined();
  });
});
