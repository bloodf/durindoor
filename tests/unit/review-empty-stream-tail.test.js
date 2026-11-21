import { describe, expect, it, vi } from "vitest";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function body(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function drain(stream) {
  const reader = stream.getReader();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output;
    output += decoder.decode(value, { stream: true });
  }
}

describe("empty-stream guard EOF line", () => {
  it("classifies an unterminated final terminal line and retries it", async () => {
    const emptyTerminal = `data: ${JSON.stringify({ response: { candidates: [{ finishReason: "STOP" }] } })}`;
    const answer = `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "recovered" }] } }] } })}\n\n`;
    const reexecute = vi.fn(async () => body(answer));
    const output = await drain(createEmptyRetryStream({
      body: body(emptyTerminal),
      reexecute,
      baseDelayMs: 1,
      log: null,
    }));

    expect(reexecute).toHaveBeenCalledOnce();
    expect(output).toBe(answer);
    expect(output).not.toContain('"finishReason":"STOP"');
  });
});
