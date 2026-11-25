import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const db = vi.hoisted(() => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), trackPendingRequest: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => db);

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

const candidate = (parts, finishReason) => ({
  responseId: "fixture-response-id", modelVersion: "gemini-fixture",
  candidates: [{ index: 0, content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}) }],
});
const tool = candidate([{ functionCall: { id: "tool-fixture", name: "read", args: { file_path: "private-tool-argument" } } }]);

async function run(frames, sourceFormat, suffix = "\n\n") {
  const onStreamComplete = vi.fn();
  const text = frames.map((frame) => `data: ${JSON.stringify({ response: frame })}`).join("\n\n") + (frames.length ? suffix : "");
  const output = await new Response(new Response(text).body.pipeThrough(createSSEStream({
    targetFormat: FORMATS.ANTIGRAVITY, sourceFormat, provider: "antigravity", model: "gemini-fixture", body: { messages: [] }, onStreamComplete,
  }))).text();
  return { output, onStreamComplete };
}

beforeEach(() => vi.clearAllMocks());

describe("upstream #4486 - a Gemini stream cut before its finish reason ends with an error", () => {
  it.each([
    ["text", [candidate([{ text: "partial" }])]],
    ["tool call", [tool]],
    ["nothing", []],
  ])("Claude clients get an error event, not message_stop (%s)", async (_label, frames) => {
    const { output, onStreamComplete } = await run(frames, FORMATS.CLAUDE);
    expect(output.match(/^event: error$/gm)).toHaveLength(1);
    expect(output).toContain("incomplete_upstream_stream");
    expect(output).not.toContain("message_stop");
    expect(output).not.toContain("private-tool-argument");
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toMatchObject({ code: "incomplete_upstream_stream" });
    expect(db.appendRequestLog).not.toHaveBeenCalledWith(expect.objectContaining({ status: "200 OK" }));
  });

  it("Chat Completions clients get the error before one [DONE] and no finish_reason", async () => {
    const { output } = await run([candidate([{ text: "partial" }])], FORMATS.OPENAI);
    expect(output).toContain("incomplete_upstream_stream");
    expect(output).not.toMatch(/"finish_reason":"/);
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("Responses clients get response.failed, not response.completed", async () => {
    const { output } = await run([candidate([{ text: "partial" }])], FORMATS.OPENAI_RESPONSES);
    expect(output).toContain("event: response.failed");
    expect(output).not.toContain("event: response.completed");
  });

  it.each(["\n\n", ""])("keeps a finished stream successful (line ending %j)", async (suffix) => {
    const { output, onStreamComplete } = await run([candidate([{ text: "ok" }]), candidate([], "STOP")], FORMATS.CLAUDE, suffix);
    expect(output).toContain("message_stop");
    expect(output).not.toContain("incomplete_upstream_stream");
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toBeUndefined();
  });

  it("keeps a prompt block as a finished turn", async () => {
    const { output } = await run([{ promptFeedback: { blockReason: "SAFETY" } }], FORMATS.OPENAI);
    expect(output).toContain("content_filter");
    expect(output).not.toContain("incomplete_upstream_stream");
  });
});
