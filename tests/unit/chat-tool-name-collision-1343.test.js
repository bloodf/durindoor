import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { normalizeOpenAIToolNames, composeToolNameMaps } from "../../open-sse/translator/concerns/toolCall.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../../open-sse/translator/schema/index.js";

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "test" }));
const dotted = "ns.search";
const validCollision = "ns_search_d2c032363399";
const tool = (name) => ({ type: OPENAI_BLOCK.FUNCTION, function: { name, parameters: { type: "object" } } });
const call = (name, id) => ({ id, type: OPENAI_BLOCK.FUNCTION, function: { name, arguments: "{}" } });
function body(names) {
  return {
    tools: names.map(tool),
    tool_choice: { type: OPENAI_BLOCK.FUNCTION, function: { name: dotted } },
    messages: [
      { role: ROLE.USER, content: "use tools" },
      { role: ROLE.ASSISTANT, tool_calls: names.map((name, i) => call(name, `c${i}`)) },
      ...names.map((name, i) => ({ role: ROLE.TOOL, name, tool_call_id: `c${i}`, content: "ok" })),
    ],
  };
}

describe("generated aliases cannot steal existing tool identities (#1343)", () => {
  it.each([[dotted, validCollision], [validCollision, dotted]])("reserves valid originals independent of declaration order: %j / %j", (...names) => {
    const input = body(names);
    const map = normalizeOpenAIToolNames(input);
    const aliases = input.tools.map((entry) => entry.function.name);
    expect(new Set(aliases).size).toBe(2);
    names.forEach((name, i) => {
      expect(map.get(aliases[i]) ?? aliases[i]).toBe(name);
      expect(input.messages[1].tool_calls[i].function.name).toBe(aliases[i]);
      expect(input.messages[i + 2].name).toBe(aliases[i]);
      if (name === validCollision) expect(aliases[i]).toBe(name);
    });
    expect(map.get(input.tool_choice.function.name)).toBe(dotted);
  });

  it("reserves originals that only occur in allowed choices or historical calls", () => {
    const input = body([dotted]);
    input.tool_choice = { type: "allowed_tools", allowed_tools: { tools: [tool(validCollision)] } };
    input.messages[1].tool_calls.push(call(validCollision, "old"));
    const aliases = normalizeOpenAIToolNames(input);
    const alias = input.tools[0].function.name;
    expect(alias).not.toBe(validCollision);
    expect(aliases.get(alias)).toBe(dotted);
    expect(input.tool_choice.allowed_tools.tools[0].function.name).toBe(validCollision);
    expect(input.messages[1].tool_calls[1].function.name).toBe(validCollision);
  });

  it("remains idempotent and composes through a stricter name ceiling", () => {
    const input = body([dotted, validCollision]);
    const first = normalizeOpenAIToolNames(input);
    const once = structuredClone(input);
    expect(normalizeOpenAIToolNames(input).size).toBe(0);
    expect(input).toEqual(once);
    const second = normalizeOpenAIToolNames(input, 20);
    const composed = composeToolNameMaps(first, second);
    expect(new Set(input.tools.map((entry) => entry.function.name)).size).toBe(2);
    [dotted, validCollision].forEach((original, i) => {
      const alias = input.tools[i].function.name;
      expect(alias.length).toBeLessThanOrEqual(20);
      expect(composed.get(alias) ?? alias).toBe(original);
    });
  });

  it("preserves distinct declarations, history and restoration on Chat to Claude", () => {
    const output = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", body([dotted, validCollision]), false);
    const aliases = output.tools.map((entry) => entry.name);
    expect(new Set(aliases).size).toBe(2);
    expect(output._toolNameMap.get(aliases[0])).toBe(dotted);
    expect(output._toolNameMap.get(aliases[1]) ?? aliases[1]).toBe(validCollision);
    const calls = output.messages.flatMap((message) => message.content).filter((entry) => entry.type === CLAUDE_BLOCK.TOOL_USE);
    expect(calls.map((entry) => entry.name)).toEqual(aliases);
    expect(output.tool_choice.name).toBe(aliases[0]);
  });

  it.each([60, 64, 65, 100])("budgets for the final Claude OAuth suffix for a %i-character name", (length) => {
    const original = "x".repeat(length);
    const input = body([original]);
    input.tool_choice.function.name = original;
    const output = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4-5", input, false,
      { accessToken: "sk-ant-oat-fixture" }, "claude");
    const mapped = [...output._toolNameMap].filter(([alias, name]) =>
      name === original && output.tools.some((entry) => entry.name === alias));
    expect(mapped).toHaveLength(1);
    const alias = mapped[0][0];
    expect(alias.length).toBeLessThanOrEqual(64);
    expect(output.tools.some((entry) => entry.name === alias)).toBe(true);
    expect(output.tool_choice.name).toBe(alias);
    expect(output.messages.flatMap((message) => message.content).find((entry) => entry.type === CLAUDE_BLOCK.TOOL_USE).name).toBe(alias);
  });
});
