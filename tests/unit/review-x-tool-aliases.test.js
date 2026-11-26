import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aliasLongResponsesToolNames } from "../../open-sse/utils/responsesToolNames.js";
import { restoreOpenAIToolNames } from "../../open-sse/translator/concerns/toolCall.js";

function originalAlias(name) {
  return `${name.slice(0, 51)}_${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
}

describe("Responses tool alias collisions", () => {
  it("reserves real names and restores calls without capturing a 64-character tool", () => {
    const long = "a".repeat(70);
    const real = originalAlias(long);
    const body = {
      tools: [{ type: "function", name: long }, { type: "function", name: real }],
      tool_choice: { type: "function", name: long },
      input: [{ type: "function_call", name: long }, { type: "function_call", name: real }]
    };
    const aliases = aliasLongResponsesToolNames(body);
    const outbound = body.tools[0].name;
    expect(real).toHaveLength(64);
    expect(outbound).toHaveLength(64);
    expect(outbound).not.toBe(real);
    expect(body.tools[1].name).toBe(real);
    expect(body.tool_choice.name).toBe(outbound);
    expect(body.input.map((item) => item.name)).toEqual([outbound, real]);
    const response = { output: [{ type: "function_call", name: outbound }, { type: "function_call", name: real }] };
    restoreOpenAIToolNames(response, aliases);
    expect(response.output.map((item) => item.name)).toEqual([long, real]);

    const reversed = { tools: [{ type: "function", name: real }, { type: "function", name: long }] };
    aliasLongResponsesToolNames(reversed);
    expect(reversed.tools[1].name).toBe(outbound);
  });
});
