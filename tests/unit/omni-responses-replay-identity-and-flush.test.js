import { it, expect, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn()
}));
it("drops an unterminated replay after completion", async () => {
  const payloads = [
    { type: "response.created", sequence_number: 0, response: { id: "r1" } },
    { type: "response.output_text.delta", sequence_number: 1, delta: "hello" },
    { type: "response.completed", sequence_number: 2, response: { id: "r1", status: "completed", output: [], usage: { input_tokens: 2, output_tokens: 1 } } },
    { type: "response.output_text.delta", sequence_number: 1, delta: "hello" }
  ];
  const input = payloads.map(p => "data: " + JSON.stringify(p)).join("\n\n");
  const stream = createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "codex",
    null, null, "gpt-test", null, {});
  const output = await new Response(new Response(input).body.pipeThrough(stream)).text();
  const wire = output.match(/"content":"hello"/g)?.length;
  expect(wire).toBe(1);
});

it("does not treat a fresh response's deltas as old after a late completion replay", async () => {
  const payloads = [
    {type:"response.created",sequence_number:0,response:{id:"a",status:"in_progress"}},
    {type:"response.output_text.delta",sequence_number:1,delta:"first"},
    {type:"response.completed",sequence_number:3,response:{id:"a",status:"completed",usage:{input_tokens:2,output_tokens:1}}},
    {type:"response.created",sequence_number:0,response:{id:"b",status:"in_progress"}},
    {type:"response.output_text.delta",sequence_number:1,delta:"second"},
    {type:"response.completed",sequence_number:3,response:{id:"a",status:"completed",usage:{input_tokens:2,output_tokens:1}}},
    {type:"response.output_text.delta",sequence_number:2,delta:"lost"},
    {type:"response.completed",sequence_number:3,response:{id:"b",status:"completed",usage:{input_tokens:3,output_tokens:2}}}
  ];
  const input = payloads.map(p => "data: " + JSON.stringify(p)).join("\n\n") + "\n\ndata: [DONE]\n\n";
  const {createPassthroughStreamWithLogger} = await import("../../open-sse/utils/stream.js");
  const stream = createPassthroughStreamWithLogger("codex", null, null, "gpt-test", null, {}, null, null, FORMATS.OPENAI_RESPONSES);
  const output = await new Response(new Response(input).body.pipeThrough(stream)).text();
  const deltas = [...output.matchAll(/"delta":"([^"]+)"/g)].map(m => m[1]);
  expect(deltas).toEqual(["first", "second", "lost"]);
});

it("drops an unterminated replay when the upstream disconnects before completion", async () => {
  const payloads = [
    { type: "response.created", sequence_number: 0, response: { id: "r1" } },
    { type: "response.output_text.delta", sequence_number: 1, delta: "hello" },
    { type: "response.output_text.delta", sequence_number: 1, delta: "hello" }
  ];
  const input = payloads.map(p => "data: " + JSON.stringify(p)).join("\n\n");
  const stream = createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "codex",
    null, null, "gpt-test", null, {});
  const output = await new Response(new Response(input).body.pipeThrough(stream)).text();
  const wire = output.match(/"content":"hello"/g)?.length;
  expect(wire).toBe(1);
});

it("keeps the active watermark across unrelated usage and terminal frames", async () => {
  const { createResponsesSequenceReplayTracker } = await import("../../open-sse/utils/responsesSequenceReplay.js");
  const tracker = createResponsesSequenceReplayTracker();
  const event = (type, sequence_number, response) => ({ type, sequence_number, response });
  expect(tracker.isReplay(event("response.created", 0, { id: "a" }))).toBe(false);
  expect(tracker.isReplay(event("response.created", 0, { id: "b" }))).toBe(false);
  expect(tracker.isReplay(event("response.output_text.delta", 1))).toBe(false);
  expect(tracker.isReplay(event("response.completed", 50, { id: "a", status: "completed" }))).toBe(false);
  expect(tracker.isReplay(event("response.output_text.done", 60, { id: "a", usage: { output_tokens: 1 } }))).toBe(false);
  expect(tracker.isReplay({ done: true })).toBe(false);
  expect(tracker.isReplay(event("response.output_text.delta", 1))).toBe(true);
  expect(tracker.isReplay(event("response.output_text.delta", 2))).toBe(false);
  const independent = createResponsesSequenceReplayTracker();
  expect(independent.isReplay(event("response.output_text.delta", 1))).toBe(false);
  expect(independent.isReplay(event("response.output_text.delta", 1))).toBe(true);
});
