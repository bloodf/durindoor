import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { createResponsesToolNameResolver } from "../../open-sse/translator/response/openai-responses.js";
import { projectCompletionToClientFormat } from "../../open-sse/translator/response/completionProjector.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const GRAMMAR = "start: /.+/";
const request = () => ({
  input: "hi",
  tools: [
    { type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec", description: "Run code", format: { type: "grammar", syntax: "lark", definition: GRAMMAR } }] },
    { type: "namespace", name: "collaboration", tools: [{ type: "function", name: "exec", parameters: { type: "object", properties: { message: { type: "string" } } } }] },
  ],
});
const translate = (target) => translateRequest(FORMATS.OPENAI_RESPONSES, target, "m", request(), true, null, "openai");
const wireName = (out, clientName) => [...out._toolNameMap].find(([, name]) => name === clientName)[0];
const call = (name, args) => ({ id: "call_1", type: "function", function: { name, arguments: args } });
const RAW = "return 1;";
const ARGS = JSON.stringify({ input: RAW });
const CUSTOM_ITEM = { type: "custom_tool_call", namespace: "functions", name: "exec", input: RAW, call_id: "call_1" };

describe("port(upstream) #4810 namespaced custom tools", () => {
  it("declares the raw input argument and grammar for a namespaced custom tool", () => {
    const out = translate(FORMATS.OPENAI);
    const custom = out.tools.find((tool) => tool.function.name === wireName(out, "functions.exec")).function;

    expect(custom.parameters.required).toEqual(["input"]);
    expect(custom.parameters.properties.input.type).toBe("string");
    expect(custom.description).toContain(GRAMMAR);
    expect(out._customToolNames).toEqual(["functions.exec"]);
  });

  it("restores a streamed call as a custom_tool_call, beside a same-named namespace function", () => {
    const out = translate(FORMATS.OPENAI);
    const run = (clientName, args) => {
      const state = { ...initState(FORMATS.OPENAI_RESPONSES, request()), toolNameMap: out._toolNameMap };
      return [
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call(wireName(out, clientName), args) }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ].flatMap((chunk) => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state))
        .filter((event) => /output_item\.(added|done)/.test(event.event))
        .map((event) => event.data.item);
    };

    const [added, done] = run("functions.exec", ARGS);
    expect(added).toMatchObject({ type: "custom_tool_call", namespace: "functions", name: "exec" });
    expect(done).toMatchObject(CUSTOM_ITEM);
    expect(run("collaboration.exec", "{}").at(-1)).toMatchObject({ type: "function_call", namespace: "collaboration", name: "exec" });
  });

  it("restores a buffered completion as a namespaced custom_tool_call", () => {
    const out = translate(FORMATS.OPENAI);
    const completion = { choices: [{ message: { role: "assistant", tool_calls: [call(wireName(out, "functions.exec"), ARGS)] }, finish_reason: "tool_calls" }] };
    const projected = projectCompletionToClientFormat(completion, FORMATS.OPENAI_RESPONSES, {
      customToolNames: new Set(out._customToolNames),
      resolveToolName: createResponsesToolNameResolver(request(), out._toolNameMap),
    });

    expect(projected.output[0]).toMatchObject(CUSTOM_ITEM);
  });

  it("replays namespaced custom history under the declared wire name", () => {
    const body = request();
    body.input = [
      { type: "custom_tool_call", namespace: "functions", name: "exec", call_id: "call_1", input: RAW },
      { type: "custom_tool_call_output", call_id: "call_1", output: "ok" },
    ];
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true, null, "openai");
    const replayed = out.messages.find((message) => message.tool_calls).tool_calls[0].function;

    expect(replayed.name).toBe(wireName(out, "functions.exec"));
    expect(JSON.parse(replayed.arguments)).toEqual({ input: RAW });
  });
});
