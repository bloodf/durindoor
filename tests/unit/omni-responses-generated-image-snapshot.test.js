import { describe, expect, it, vi } from "vitest";
import { createEmptyTerminalGuard, hasResponsesSnapshotOutput } from "../../open-sse/utils/emptyStreamTerminal.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn() }));

const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const image = { type: "image_generation_call", status: "completed", id: "ig_fixture", result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2sAAAAASUVORK5CYII=" };
const terminal = (output, extra = {}) => ({ type: "response.completed", response: { status: "completed", output, ...extra } });

async function run(events) {
  const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");
  let verdict, completion;
  const transform = createPassthroughStreamWithLogger("openai", null, null, "fixture", null, {}, (content, usage) => {
    completion = { content, usage };
    verdict = !content.upstreamError && !content.content?.trim() && !content.thinking?.trim() && !content.hadToolCalls && !content.hasSnapshotOutput && !usage?.completion_tokens;
  }, null, FORMATS.OPENAI_RESPONSES);
  const input = events.map(frame).join("");
  const output = await new Response(new Response(input).body.pipeThrough(transform).pipeThrough(createEmptyTerminalGuard(FORMATS.OPENAI_RESPONSES, () => verdict, () => transform.getEmptyStreamSnapshot()))).text();
  return { input, output, verdict, completion };
}

describe("native Responses generated image snapshots", () => {
  it("preserves the completed image without usage and in event order", async () => {
    const events = [{ type: "response.created", response: { status: "in_progress" } }, terminal([image])];
    const result = await run(events);
    expect(result.output).toBe(result.input + "data: [DONE]\n\n");
    expect(result.verdict).toBe(false);
    expect(result.completion.content.hasSnapshotOutput).toBe(true);
    expect(result.output).not.toContain("stream_error");
  });

  it.each([undefined, null, "", "   "])("does not treat an absent image result %# as output", async (result) => {
    const observed = await run([terminal([{ ...image, result }], { text: { format: { type: "text" } }, metadata: { result: "metadata" } })]);
    expect(observed.verdict).toBe(true);
    expect(observed.output).toContain("response.failed");
  });

  it.each(["failed", "cancelled", "incomplete", "in_progress"])("does not classify a %s image as completed content", (status) => {
    expect(hasResponsesSnapshotOutput(terminal([{ ...image, status }]))).toBe(false);
    expect(hasResponsesSnapshotOutput(terminal([image], { status }))).toBe(false);
  });

  it.each(["response.failed", "response.cancelled", "response.incomplete"])("preserves a %s history", async (type) => {
    const event = { type, response: { status: type.split(".")[1], output: [image] } };
    const output = (await run([event])).output;
    expect(output.startsWith(frame(event))).toBe(true);
    expect(output).not.toContain("Provider returned empty content");
  });

  it("keeps usage and the original terminal snapshot", async () => {
    const event = terminal([image], { usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } });
    const result = await run([event]);
    expect(result.output).toBe(frame(event) + "data: [DONE]\n\n");
    expect(result.completion.usage).toMatchObject({ completion_tokens: 1 });
  });
});
