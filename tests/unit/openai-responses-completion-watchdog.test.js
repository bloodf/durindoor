import "../translator/registerAll.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

const finish = { id: "c1", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }] };
function openStream(onStreamComplete) {
  const stream = createSSEStream({ targetFormat: FORMATS.OPENAI, sourceFormat: FORMATS.OPENAI_RESPONSES, onStreamComplete });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let text = "";
  const reading = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
  })();
  return {
    writer, reader, reading,
    write: (chunk) => writer.write(new TextEncoder().encode(`data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`)),
    completed: () => text.split("\n").filter((line) => line.startsWith("data: ") && line.includes('"type":"response.completed"')).map((line) => JSON.parse(line.slice(6)).response),
    close: async () => { await writer.close(); await reading; }
  };
}

afterEach(() => vi.useRealTimers());

describe("pending Responses completion watchdog", () => {
  it("emits exactly one terminal after 3 seconds with the transport still open", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const stream = openStream(callback);
    try {
      await stream.write(finish);
      await vi.advanceTimersByTimeAsync(2999);
      expect(stream.completed()).toEqual([]);
      expect(callback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(stream.completed()).toHaveLength(1);
      expect(stream.completed()[0].status).toBe("completed");
      expect(stream.completed()[0]).not.toHaveProperty("usage");
      expect(callback).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(stream.completed()).toHaveLength(1);
    } finally { await stream.close(); }
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each(["usage", "done", "eof"])("clears the timer when %s arrives first", async (terminal) => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const stream = openStream(callback);
    let closed = false;
    try {
      await stream.write(finish);
      await vi.advanceTimersByTimeAsync(100);
      if (terminal === "usage") await stream.write({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } });
      if (terminal === "done") await stream.write("[DONE]");
      if (terminal === "eof") { await stream.close(); closed = true; }
      expect(stream.completed()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(stream.completed()).toHaveLength(1);
      expect(callback).toHaveBeenCalledTimes(1);
      if (terminal === "usage") expect(stream.completed()[0].usage).toEqual({ input_tokens: 120, output_tokens: 30, total_tokens: 150 });
    } finally { if (!closed) await stream.close(); }
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not begin a timeout before finish_reason", async () => {
    vi.useFakeTimers();
    const stream = openStream();
    try {
      await stream.write({ id: "c1", choices: [{ index: 0, delta: { content: "still generating" } }] });
      await vi.advanceTimersByTimeAsync(10000);
      expect(stream.completed()).toEqual([]);
    } finally { await stream.close(); }
  });
});
