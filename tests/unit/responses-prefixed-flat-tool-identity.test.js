import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createResponsesToolNameResolver } from "../../open-sse/translator/response/openai-responses.js";

const request = {
  input: [{ type: "function_call", call_id: "old_call", namespace: "files", name: "read", arguments: "{}" }],
  tools: [{ type: "function", name: "files.read" }],
};

describe("prefixed flat Responses tool identity", () => {
  it("preserves the current flat declaration in added and done stream items", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES, request);
    const chunks = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "new_call", type: "function", function: { name: "functions.files.read", arguments: "{}" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const items = chunks.flatMap((chunk) => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state))
      .filter((event) => event.event === "response.output_item.added" || event.event === "response.output_item.done")
      .map((event) => event.data.item)
      .filter((item) => item?.type === "function_call");
    expect(items.map(({ name, namespace }) => [name, namespace])).toEqual([
      ["files.read", undefined], ["files.read", undefined],
    ]);
  });

  it("preserves the current flat declaration in the buffered resolver", () => {
    expect(createResponsesToolNameResolver(request)("functions.files.read")).toEqual({ name: "files.read" });
  });
});
