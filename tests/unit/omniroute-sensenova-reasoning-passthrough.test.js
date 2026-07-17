import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

describe("OmniRoute #6330 — SenseNova reasoning passthrough (Thread 3)", () => {
  it("forwards a reasoning-only delta and a later content delta to the client", async () => {
    const chunks = [];
    const encoder = new TextEncoder();

    const stream = createPassthroughStreamWithLogger(
      "sensenova",
      null, // reqLogger
      null, // toolNameMap
      "sensenova-6.7-flash-lite",
      null, // connectionId
      null, // body
      () => {}, // onStreamComplete
      null, // apiKey
    );

    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();

    const reasoningChunk = JSON.stringify({
      id: "chatcmpl-sensenova-1",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "sensenova-6.7-flash-lite",
      choices: [{ index: 0, delta: { reasoning: "thinking..." }, finish_reason: null }],
    });
    const contentChunk = JSON.stringify({
      id: "chatcmpl-sensenova-1",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "sensenova-6.7-flash-lite",
      choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
    });

    // Drain the output concurrently so backpressure does not deadlock.
    const readPromise = (async () => {
      let result;
      while (!(result = await reader.read()).done) {
        const text = new TextDecoder().decode(result.value);
        for (const line of text.split("\n")) {
          if (line.startsWith("data:")) {
            chunks.push(line.slice(5).trim());
          }
        }
      }
    })();

    writer.write(encoder.encode(`data: ${reasoningChunk}\n\n`));
    writer.write(encoder.encode(`data: ${contentChunk}\n\n`));
    writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
    await readPromise;

    const dataLines = chunks.filter((c) => c && c !== "[DONE]");
    expect(dataLines.length).toBeGreaterThanOrEqual(2);

    const first = JSON.parse(dataLines[0]);
    expect(first.choices[0].delta.reasoning_content).toBe("thinking...");

    const second = JSON.parse(dataLines[dataLines.length - 1]);
    expect(second.choices[0].delta.content).toBe("hello");
  });
});
