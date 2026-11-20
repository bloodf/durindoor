import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

// Port of OmniRoute #15510 (commit 408b4f2bd): a replayed Responses event is
// dropped when its `sequence_number` was already forwarded, so a reconnect does
// not glue duplicated text into the client stream. The local port keeps the
// terminal, the usage and the [DONE] sentinel out of the suppression.

const encoder = new TextEncoder();

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function pipe(stream, text) {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(source.pipeThrough(stream)).text();
}

function passthroughResponses(frames, onComplete = null) {
  const stream = createPassthroughStreamWithLogger(
    "codex",
    null,
    null,
    "gpt-test",
    "connection-1",
    {},
    onComplete,
    null,
    FORMATS.OPENAI_RESPONSES,
  );
  return pipe(stream, frames.map((frame) => sse(frame.type, frame)).join("") + "data: [DONE]\n\n");
}

function translateResponses(frames, clientFormat, onComplete = null) {
  const stream = createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES,
    clientFormat,
    "codex",
    null,
    null,
    "gpt-test",
    null,
    { messages: [{ role: "user", content: "hello" }] },
    onComplete,
    null,
    "off",
    null,
    null,
    null,
    false,
  );
  return pipe(stream, frames.map((frame) => sse(frame.type, frame)).join("") + "data: [DONE]\n\n");
}

/** Text the OpenAI client received, from the translated chat-completion chunks. */
function openaiContent(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload))
    .flatMap((chunk) => chunk.choices ?? [])
    .map((choice) => choice.delta?.content ?? "")
    .join("");
}

/** Text the Claude client received, from the translated content-block deltas. */
function claudeContent(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload))
    .filter((event) => event.type === "content_block_delta")
    .map((event) => event.delta?.text ?? "")
    .join("");
}

const created = (id, sequence) => ({
  type: "response.created",
  sequence_number: sequence,
  response: { id, status: "in_progress" },
});

const itemAdded = (sequence) => ({
  type: "response.output_item.added",
  sequence_number: sequence,
  output_index: 0,
  item: { id: "msg_1", type: "message", content: [], role: "assistant" },
});

const textDelta = (sequence, delta) => ({
  type: "response.output_text.delta",
  sequence_number: sequence,
  item_id: "msg_1",
  output_index: 0,
  content_index: 0,
  delta,
});

const completed = (id, sequence, usage) => ({
  type: "response.completed",
  sequence_number: sequence,
  response: { id, status: "completed", output: [], usage },
});

describe("Responses sequence replay suppression", () => {
  it("drops a repeated Responses event in the translated stream", async () => {
    const text = await translateResponses([
      created("resp_1", 0),
      itemAdded(1),
      textDelta(2, "once"),
      textDelta(2, "twice"),
      completed("resp_1", 3, { input_tokens: 10, output_tokens: 20 }),
    ], FORMATS.OPENAI);

    expect(openaiContent(text)).toBe("once");
    expect(openaiContent(text)).not.toContain("twice");
  });

  it("drops a repeated Responses event in the passthrough stream", async () => {
    const text = await passthroughResponses([
      created("resp_1", 0),
      itemAdded(1),
      textDelta(2, "once"),
      textDelta(2, "twice"),
      completed("resp_1", 3, { input_tokens: 10, output_tokens: 20 }),
    ]);

    expect(text).toContain('"delta":"once"');
    expect(text).not.toContain("twice");
    // The dropped frame takes its event label with it.
    expect(text.match(/event: response\.output_text\.delta/g)).toHaveLength(1);
  });

  it("treats a decimal-string sequence number like a numeric one", async () => {
    const text = await translateResponses([
      created("resp_1", "0"),
      itemAdded("1"),
      textDelta("2", "once"),
      textDelta("2", "twice"),
      completed("resp_1", "3", { input_tokens: 10, output_tokens: 20 }),
    ], FORMATS.OPENAI);

    expect(openaiContent(text)).toBe("once");
  });

  it("drops an out-of-order Responses event", async () => {
    const text = await translateResponses([
      created("resp_1", 0),
      itemAdded(1),
      textDelta(3, "later"),
      textDelta(2, "out-of-order"),
      completed("resp_1", 4, { input_tokens: 10, output_tokens: 20 }),
    ], FORMATS.OPENAI);

    expect(openaiContent(text)).toBe("later");
  });

  it("does not treat a sequence past the safe integer range as a replay", async () => {
    const huge = "9007199254740993";
    const text = await translateResponses([
      textDelta(huge, "a"),
      textDelta(huge, "b"),
    ], FORMATS.OPENAI);

    expect(openaiContent(text)).toBe("ab");
  });

  it("keeps an invalid or missing sequence value unchanged", async () => {
    const invalid = [undefined, null, -1, 1.5, "01", "1.5", "1e3", ""];
    const frames = invalid.flatMap((value) => [
      textDelta(value, "a"),
      textDelta(value, "b"),
    ]);

    const text = await translateResponses(frames, FORMATS.OPENAI);

    expect(openaiContent(text)).toBe(invalid.map(() => "ab").join(""));
  });

  it("scopes the watermark to a single upstream response", async () => {
    const text = await passthroughResponses([
      created("resp_1", 0),
      textDelta(1, "first"),
      completed("resp_1", 2, { input_tokens: 5, output_tokens: 5 }),
      // A second response restarts its own numbering.
      created("resp_2", 0),
      textDelta(1, "second"),
      completed("resp_2", 2, { input_tokens: 5, output_tokens: 5 }),
    ]);

    expect(text).toContain('"delta":"first"');
    expect(text).toContain('"delta":"second"');
  });

  it("keeps a terminal, its usage and the [DONE] sentinel when the sequence is a replay", async () => {
    const onComplete = vi.fn();
    const text = await passthroughResponses([
      created("resp_1", 0),
      textDelta(1, "once"),
      completed("resp_1", 2, { input_tokens: 10, output_tokens: 20 }),
      // A reconnect re-sends the terminal with the number it already had.
      completed("resp_1", 2, { input_tokens: 10, output_tokens: 20 }),
    ], onComplete);

    expect(text).toContain("event: response.completed");
    expect(text).toContain('"output_tokens":20');
    expect(text).toContain("data: [DONE]");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][1]).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 20,
    });
  });

  it("keeps a usage-bearing event that replays an earlier sequence number", async () => {
    const onComplete = vi.fn();
    const text = await passthroughResponses([
      created("resp_1", 0),
      textDelta(1, "once"),
      // A non-terminal frame that carries the accounting is never suppressed.
      {
        type: "response.output_text.done",
        sequence_number: 1,
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        text: "once",
        usage: { input_tokens: 7, output_tokens: 3 },
      },
      completed("resp_1", 2, { input_tokens: 10, output_tokens: 20 }),
    ], onComplete);

    expect(text).toContain("event: response.output_text.done");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][1]).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 20,
    });
  });

  it("completes the translated stream once, with the replayed text left out", async () => {
    const onComplete = vi.fn();
    const text = await translateResponses([
      created("resp_1", 0),
      itemAdded(1),
      textDelta(2, "once"),
      textDelta(2, "twice"),
      completed("resp_1", 3, { input_tokens: 10, output_tokens: 20 }),
    ], FORMATS.CLAUDE, onComplete);

    expect(claudeContent(text)).toBe("once");
    expect(onComplete).toHaveBeenCalledTimes(1);
    // The completion summary carries the text once, not glued with the replay.
    const summary = onComplete.mock.calls[0][3];
    expect(JSON.stringify(summary)).toContain("once");
    expect(JSON.stringify(summary)).not.toContain("twice");
  });

  it("leaves another provider protocol unchanged", async () => {
    const stream = createPassthroughStreamWithLogger(
      "openai",
      null,
      null,
      "gpt-test",
      "connection-1",
      {},
      null,
      null,
      FORMATS.OPENAI,
    );
    const frame = {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-test",
      sequence_number: 4,
      choices: [{ index: 0, delta: { content: "kept" }, finish_reason: null }],
    };
    // The same counter twice is no replay for another protocol.
    const text = await pipe(stream, `data: ${JSON.stringify(frame)}\ndata: ${JSON.stringify(frame)}\ndata: [DONE]\n\n`);

    expect(text.match(/"content":"kept"/g)).toHaveLength(2);
  });

  it("does not report a completion twice when the client disconnects", async () => {
    const onComplete = vi.fn();
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      "codex",
      null,
      null,
      "gpt-test",
      null,
      { messages: [{ role: "user", content: "hello" }] },
      onComplete,
      null,
      "off",
      null,
      null,
      null,
      false,
    );
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const frames = [
      created("resp_1", 0),
      itemAdded(1),
      textDelta(2, "once"),
      textDelta(2, "twice"),
      completed("resp_1", 3, { input_tokens: 10, output_tokens: 20 }),
    ];

    // Drain the readable side while the frames are written, so the transform
    // never blocks on backpressure.
    const drained = (async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
        return null;
      } catch (error) {
        return error;
      }
    })();

    await writer.write(encoder.encode(frames.map((frame) => sse(frame.type, frame)).join("")));
    await writer.abort(new Error("client disconnected"));

    expect(await drained).toBeTruthy();
    expect(onComplete.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
