import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { buildTransformStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), trackPendingRequest: vi.fn(), saveRequestDetail: vi.fn() }));

async function runStream(userAgent, terminal, usage) {
  const onStreamComplete = vi.fn();
  const { stream } = buildTransformStream({ targetFormat: FORMATS.OPENAI_RESPONSES,
    sourceFormat: FORMATS.OPENAI_RESPONSES, provider: "codex", userAgent, onStreamComplete });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const frames = [];
  const reading = (async () => {
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      frames.push(decoder.decode(value, { stream: true }));
    }
  })();
  const events = [
    { type: "response.output_text.delta", delta: "partial answer", sequence_number: 1 },
    { type: `response.${terminal}`, sequence_number: 2, response: {
      id: "resp_fixture", status: terminal === "done" ? "completed" : terminal,
      ...(terminal === "failed" ? { error: { code: "fixture_error", message: "upstream failed" } } : {}),
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "partial answer" }] }],
      ...(usage === undefined ? {} : { usage })
    } }
  ];
  for (const event of events) {
    await writer.write(new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
  }
  await writer.write(new TextEncoder().encode("data: [DONE]\n\n"));
  await writer.close();
  await reading;
  return { events, output: frames.join(""), onStreamComplete };
}

const reported = { input_tokens: 7, output_tokens: 3, total_tokens: 10 };

describe.each(["ordinary-client/1.0", "codex-cli/1.0"])("Responses %s streaming usage", (userAgent) => {
  it.each(["incomplete", "completed", "done"])("accounts for reported %s usage once and preserves the terminal", async (terminal) => {
    const { events, output, onStreamComplete } = await runStream(userAgent, terminal, reported);
    const data = output.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    expect(data.filter((event) => event.type === `response.${terminal}`)).toEqual([events[1]]);
    expect(data).toContainEqual(events[0]);
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][1]).toMatchObject({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
  });

  it("preserves explicit terminal errors without treating them as incomplete usage", async () => {
    const { events, output, onStreamComplete } = await runStream(userAgent, "failed", reported);
    expect(output).toContain(JSON.stringify(events[1]));
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toMatchObject({ code: "fixture_error", message: "upstream failed" });
    expect(onStreamComplete.mock.calls[0][1] ?? null).toBeNull();
  });

  it("does not invent usage when the incomplete terminal omits it", async () => {
    const { events, output, onStreamComplete } = await runStream(userAgent, "incomplete");
    expect(output).toContain(JSON.stringify(events[1]));
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][1] ?? null).toBeNull();
  });
});
