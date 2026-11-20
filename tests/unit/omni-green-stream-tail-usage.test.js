import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn() }));

const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;

describe("ordinary stream tail accounting", () => {
  it.each(["passthrough", "translated"])("records trailing usage once in %s mode", async (mode) => {
    const complete = vi.fn();
    const body = { messages: [{ role: "user", content: "hello" }] };
    const transform = mode === "passthrough"
      ? createPassthroughStreamWithLogger("openai", null, null, "test", "connection", body, complete)
      : createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "openai", null, null, "test", "connection", body, complete);
    const input = frame({ choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] })
      + frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })
      + frame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } })
      + "data: [DONE]\n\n";
    const output = await new Response(new Response(input).body.pipeThrough(transform)).text();
    expect(output).toContain("answer");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toMatchObject({ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });
    if (mode === "passthrough") expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    else expect(output.match(/event: message_stop/g)).toHaveLength(1);
  });
});
