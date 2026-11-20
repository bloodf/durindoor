import { describe, expect, it, vi } from "vitest";
import { createEmptyTerminalGuard } from "../../open-sse/utils/emptyStreamTerminal.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn() }));

const frame = (payload) => `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
const message = (text) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
async function run(events) {
  const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");
  let completion, verdict;
  const transform = createPassthroughStreamWithLogger("openai", null, null, "fixture", null, {}, (content, usage) => {
    completion = { content, usage };
    verdict = !content.upstreamError && !content.content?.trim() && !content.thinking?.trim() && !content.hadToolCalls && !content.hasSnapshotOutput && !usage?.completion_tokens;
  }, null, FORMATS.OPENAI_RESPONSES);
  const input = events.map(frame).join("");
  const source = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(input)); controller.close(); } });
  const output = await new Response(source.pipeThrough(transform).pipeThrough(createEmptyTerminalGuard(FORMATS.OPENAI_RESPONSES, () => verdict, () => transform.getEmptyStreamSnapshot()))).text();
  return { output, completion, verdict };
}
const terminal = (output, extra = {}) => ({ type: "response.completed", response: { status: "completed", output, ...extra } });

describe("native Responses terminal snapshots", () => {
  it("preserves snapshot-only text and raw shape once without usage", async () => {
    const event = terminal([message("Hello")]);
    const result = await run([event]);
    expect(result.output).toContain(frame(event));
    expect(result.output.match(/Hello/g)).toHaveLength(1);
    expect(result.output).not.toContain("response.failed");
    expect(result.verdict).toBe(false);
  });
  it.each([{ type: "function_call", name: "lookup", arguments: "{}", call_id: "c1" }, { type: "custom_tool_call", name: "edit", input: "patch" }])("preserves snapshot tool output %#", async (item) => {
    const result = await run([terminal([item])]);
    expect(result.verdict).toBe(false);
    expect(result.output).toContain(JSON.stringify(item));
  });
  it("preserves usage and does not replay terminal text after a delta", async () => {
    const usage = { input_tokens: 2, output_tokens: 1, total_tokens: 3 };
    const result = await run([{ type: "response.output_text.delta", delta: "Hello" }, terminal([message("Hello")], { usage })]);
    expect(result.output.match(/response.completed/g)).toHaveLength(2); // event label and payload type
    expect(result.output).toContain(JSON.stringify(usage));
    expect(result.output).not.toContain("response.failed");
  });
  it("rejects metadata-only snapshots as empty", async () => {
    const result = await run([terminal([{ type: "message", role: "assistant", content: [{ type: "output_text", text: " " }], metadata: { text: "Hello" } }], { instructions: "Hello" })]);
    expect(result.output).toContain("response.failed");
    expect(result.verdict).toBe(true);
  });
  it("preserves provider failure", async () => {
    const failure = { type: "response.failed", response: { status: "failed", error: { message: "provider failure" } } };
    expect((await run([failure])).output).toContain("provider failure");
  });
});
