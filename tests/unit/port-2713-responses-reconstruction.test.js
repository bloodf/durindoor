/**
 * Upstream decolua/9router#2713: interleaved Responses tool fragments stay on
 * their own call, and a Responses client sees one lifecycle terminal.
 */
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

const added = (outputIndex, id, callId, name) => ({
  type: "response.output_item.added",
  output_index: outputIndex,
  item: { id, type: "function_call", call_id: callId, name, arguments: "" },
});
const argsDelta = (delta, correlator) => ({ type: "response.function_call_arguments.delta", delta, ...correlator });

function argumentsByCall(events) {
  const state = initState(FORMATS.OPENAI);
  const calls = new Map();
  for (const event of events) {
    for (const chunk of translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, event, state) || []) {
      for (const call of chunk.choices?.[0]?.delta?.tool_calls || []) {
        calls.set(call.index, (calls.get(call.index) || "") + (call.function?.arguments || ""));
      }
    }
  }
  return [...calls.values()];
}

async function runResponsesStream(events) {
  const input = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input));
      controller.close();
    },
  });
  const transform = createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "codex", null, null, "gpt-5.5",
  );
  return new Response(source.pipeThrough(transform)).text();
}

const completed = { type: "response.completed", response: { id: "resp_1", status: "completed", output: [] } };

describe("port 9router #2713: Responses stream reconstruction", () => {
  const calls = [added(0, "fc_a", "call_a", "first"), added(1, "fc_b", "call_b", "second")];

  it.each([
    ["output_index", { output_index: 0 }, { output_index: 1 }],
    ["call_id", { call_id: "call_a" }, { call_id: "call_b" }],
    ["output_index behind an unknown item_id", { item_id: "x1", output_index: 0 }, { item_id: "x2", output_index: 1 }],
  ])("keeps interleaved argument fragments on their call by %s", (_name, first, second) => {
    expect(argumentsByCall([
      ...calls,
      argsDelta('{"a":', first),
      argsDelta('{"b":', second),
      argsDelta("1}", first),
      argsDelta("2}", second),
    ])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it.each([
    ["response.failed", { id: "resp_1", status: "failed" }],
    ["response.failed with an error", { id: "resp_1", status: "failed", error: { message: "late failure" } }],
    ["response.done", { id: "resp_1", status: "completed" }],
  ])("forwards no %s after response.completed", async (name, response) => {
    const output = await runResponsesStream([completed, { type: name.split(" ")[0], response }]);

    expect(output.match(/^event: response\./gm)).toHaveLength(1);
    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("late failure");
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  // OpenAI reports a failed turn as `error` followed by `response.failed`.
  it("still forwards response.failed after an error event", async () => {
    const output = await runResponsesStream([
      { type: "error", message: "boom" },
      { type: "response.failed", response: { id: "resp_1", status: "failed" } },
    ]);
    expect(output).toContain("response.failed");
  });
});
