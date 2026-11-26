import { describe, expect, it, vi } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const call = { id: "fc_1", type: "function_call", call_id: "call_1", name: "search" };
const added = { type: "response.output_item.added", output_index: 0, item: { ...call, status: "in_progress", arguments: "" } };
const argumentsDone = { type: "response.function_call_arguments.done", output_index: 0, item_id: "fc_1", arguments: '{"q":"a"}' };
const itemDone = { type: "response.output_item.done", output_index: 0, item: { ...call, status: "completed", arguments: '{"q":"a"}' } };
const completed = (output) => ({ type: "response.completed", response: { id: "resp_1", status: "completed", output } });

async function forward(events) {
  const transform = createPassthroughStreamWithLogger("codex", null, null, "gpt-5.5", null, {}, null, null, FORMATS.OPENAI_RESPONSES);
  const sse = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const text = await new Response(new Response(sse).body.pipeThrough(transform)).text();
  const frames = text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  return frames.find((frame) => frame.type === "response.completed").response.output;
}

describe("OmniRoute #20172 - empty final Responses output", () => {
  it("backfills the finished function call as completed", async () => {
    expect(await forward([added, argumentsDone, itemDone, completed([])])).toEqual([itemDone.item]);
  });

  it("completes a call that finished its arguments but sent no done item", async () => {
    expect(await forward([added, argumentsDone, completed([])])).toEqual([
      { ...call, status: "completed", arguments: '{"q":"a"}' },
    ]);
  });

  it("does not invent a call whose arguments never finished", async () => {
    expect(await forward([added, completed([])])).toEqual([]);
  });

  it("keeps the upstream output order and leaves a non-empty output alone", async () => {
    const message = { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [] };
    const messageDone = { type: "response.output_item.done", output_index: 1, item: message };

    expect(await forward([messageDone, itemDone, completed([])])).toEqual([itemDone.item, message]);
    expect(await forward([itemDone, completed([message])])).toEqual([message]);
  });
});
