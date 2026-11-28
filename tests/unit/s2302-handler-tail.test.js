import { expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createTimelineFrameObserver } from "../../open-sse/handlers/chatCore/timelineFrameObserver.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

const records = vi.hoisted(() => []);
vi.mock("@/lib/usageDb.js", () => ({ saveRequestDetail: vi.fn(() => Promise.resolve()) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  attachClientFrameTap: (_id, format) => {
    const observer = createTimelineFrameObserver({ format, onFrame: (frame) => records.push(frame) });
    return {
      onClientBytes: (bytes, batch) => observer.push(bytes, batch),
      onClientEnd: (batch) => observer.flush(batch),
      onClientAbort: (batch) => observer.flush(batch),
    };
  },
  finishTrace: vi.fn(),
}));
vi.mock("../../open-sse/utils/streamHandler.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pipeWithDisconnect: (response, _transform, controller, _terminal, _timeout, _tracker, bytes, end, abort, _keepalive, _interval, _ttft, _guard, lineTimeline) =>
    actual.createDisconnectAwareStream({ readable: response.body }, controller, null, null, bytes, end, abort, null, 0, lineTimeline) };
});

it.each(["end", "abort"])("forwards the decoder tail through streamingHandler's %s callback", async (ending) => {
  records.length = 0;
  let sent = false;
  const source = new ReadableStream({ pull(controller) {
    if (!sent) { sent = true; controller.enqueue(new Uint8Array([0x7b, 0xc3])); }
    else if (ending === "end") controller.close();
    else controller.error(new Error("socket hang up"));
  } });
  const streamController = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn() };
  const result = await handleStreamingResponse({
    providerResponse: new Response(source, { headers: { "content-type": "application/x-ndjson" } }),
    provider: "ollama", model: "test", sourceFormat: FORMATS.OLLAMA, targetFormat: FORMATS.OLLAMA,
    body: { messages: [] }, stream: true, requestStartTime: Date.now(), streamController, traceId: "tail",
  });
  await result.response.arrayBuffer();
  expect(records).toEqual(["{�"]);
});
