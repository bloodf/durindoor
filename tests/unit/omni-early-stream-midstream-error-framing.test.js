import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKeepaliveErrorFrame, withEarlyStreamKeepalive } from "../../open-sse/utils/earlyStreamKeepalive.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const privateError = "private upstream detail";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup(format = "chat") {
  vi.useFakeTimers();
  const handler = deferred();
  const responsePromise = withEarlyStreamKeepalive(handler.promise, { thresholdMs: 1, errorFormat: format });
  await vi.advanceTimersByTimeAsync(1);
  const reader = (await responsePromise).body.getReader();
  expect(decoder.decode((await reader.read()).value)).toBe(": keepalive\n\n");

  const actions = [];
  let waiting;
  const cancel = vi.fn();
  const stream = new ReadableStream({
    async pull(controller) {
      if (!actions.length) await new Promise((resolve) => { waiting = resolve; });
      const action = actions.shift();
      if (action === "error") controller.error(new Error(privateError));
      else if (action === "close") controller.close();
      else controller.enqueue(encoder.encode(action));
    },
    cancel,
  }, { highWaterMark: 0 });
  handler.resolve(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
  function send(action) {
    actions.push(action);
    if (waiting) { const wake = waiting; waiting = undefined; wake(); }
  }
  return { reader, send, cancel };
}

afterEach(() => vi.useRealTimers());

describe("early keepalive SSE reader failures", () => {
  it.each([
    ["chat", ["data: one\n", "\n"]],
    ["responses", ["event: message\r\ndata: one\r", "\n\r\n"]],
    ["claude", ["data: one\n\n"]],
    ["chat", ["data: one\n\r", "\n"]],
    ["responses", ["data: one\r", "\n", "\n"]],
  ])("appends one generic %s error after a complete split event", async (format, chunks) => {
    const { reader, send } = await setup(format);
    for (const chunk of chunks) {
      send(chunk);
      expect(decoder.decode((await reader.read()).value)).toBe(chunk);
    }
    send("error");
    const terminal = decoder.decode((await reader.read()).value);
    expect(terminal).toBe(decoder.decode(buildKeepaliveErrorFrame(format)));
    expect(terminal).not.toContain(privateError);
    expect((await reader.read()).done).toBe(true);
  });

  it.each(["data: incomplete", "data: one\n", "data: one\r\n\r"])("errors safely after a cut event %j", async (chunk) => {
    const { reader, send } = await setup();
    send(chunk);
    expect(decoder.decode((await reader.read()).value)).toBe(chunk);
    send("error");
    await expect(reader.read()).rejects.toThrow("Upstream stream failed before completion.");
    await expect(reader.read()).rejects.not.toThrow(privateError);
  });

  it("closes cleanly without a synthetic error on EOF", async () => {
    const { reader, send } = await setup();
    send("data: one\n\n");
    expect(decoder.decode((await reader.read()).value)).toBe("data: one\n\n");
    send("close");
    expect((await reader.read()).done).toBe(true);
  });

  it("cancels the owned upstream reader", async () => {
    const { reader, send, cancel } = await setup();
    send("data: one\n\n");
    expect(decoder.decode((await reader.read()).value)).toBe("data: one\n\n");
    await reader.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
