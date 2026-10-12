import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_BLOCK } from "../../open-sse/translator/schema/index.js";

const schema = {
  type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false,
};

// Native custom tools have no strict execution guarantee. Assert their documented
// { input: string } lowering alongside a strict namespaced function, not a new
// custom strict contract or numeric tool-call ceiling.
describe("#1089 registered mixed custom/namespace strict and parallel boundary", () => {
  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])("preserves namespace strict=%s with parallel_tool_calls=%s", (strict, parallel) => {
    const request = () => ({
      input: "search, then patch",
      tools: [
        { type: "custom", name: "files.patch", description: "Apply raw patch text" },
        { type: "namespace", name: "research", tools: [
          { type: OPENAI_BLOCK.FUNCTION, name: "search", parameters: schema, strict },
        ] },
      ],
      tool_choice: { type: OPENAI_BLOCK.FUNCTION, name: "search", namespace: "research" },
      parallel_tool_calls: parallel,
    });
    const chat = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", request(), false);
    const claude = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "claude-haiku-4-5", request(), false);
    const [custom, namespaced] = chat.tools.map((tool) => tool.function);

    expect(custom.parameters).toEqual({
      type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false,
    });
    expect(custom.strict).toBeUndefined();
    expect(chat._customToolNames).toEqual(["files.patch"]);
    expect(namespaced).toMatchObject({ strict, parameters: schema });
    expect(chat.parallel_tool_calls).toBe(parallel);
    expect(chat.tool_choice).toEqual({ type: OPENAI_BLOCK.FUNCTION, function: { name: namespaced.name } });
    expect(custom.name).toBe("files.patch");
    expect(namespaced.name).toBe("research.search");
    expect(new Set([custom.name, namespaced.name]).size).toBe(2);

    const [customAlias, namespaceAlias] = claude.tools.map((tool) => tool.name);
    expect(claude._toolNameMap.get(customAlias)).toBe(custom.name);
    expect(claude._toolNameMap.get(namespaceAlias)).toBe(namespaced.name);
    expect(new Set([customAlias, namespaceAlias]).size).toBe(2);
    expect(claude.tools[0]).toMatchObject({ input_schema: custom.parameters });
    expect(claude.tools[0].strict).toBeUndefined();
    expect(claude.tools[1]).toMatchObject({ input_schema: schema, strict });
    expect(claude._customToolNames).toEqual(["files.patch"]);
    expect(claude.tool_choice).toEqual({
      type: "tool", name: namespaceAlias,
      ...(parallel === false ? { disable_parallel_tool_use: true } : {}),
    });
    expect(claude).not.toHaveProperty("parallel_tool_calls");
  });
});
