import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";
import { buildStreamErrorBytes } from "../../open-sse/utils/streamHelpers.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";

function decode(bytes) {
  return new TextDecoder().decode(bytes);
}

// Minimal stream controller stub, mirrors responses-abort-terminal.test.js
function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("buildStreamErrorBytes", () => {
  it("frames an OpenAI-compatible error then [DONE]", () => {
    const text = decode(buildStreamErrorBytes(HTTP_STATUS.GATEWAY_TIMEOUT, "stream stall timeout", FORMATS.OPENAI));

    expect(text).toContain('"error"');
    expect(text).toContain("stream stall timeout");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("frames a Claude error event with no [DONE] terminator", () => {
    const text = decode(buildStreamErrorBytes(HTTP_STATUS.GATEWAY_TIMEOUT, "upstream connection lost", FORMATS.CLAUDE));

    expect(text).toContain("event: error");
    expect(text).toContain("upstream connection lost");
    expect(text).not.toContain("[DONE]");
  });

  it("frames formats with no dedicated client-terminal tracker (e.g. Gemini) using the OpenAI-shaped fallback", () => {
    const text = decode(buildStreamErrorBytes(HTTP_STATUS.GATEWAY_TIMEOUT, "stream ttft timeout", FORMATS.GEMINI));

    expect(text).toContain('"error"');
    expect(text).toContain("stream ttft timeout");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });
});

describe("in-band abort reporting for untracked emitted formats", () => {
  it("reports a lost upstream connection in-band instead of closing silently (Ollama has no terminal tracker)", async () => {
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"response":"partial"}\n'));
        controller.error(new Error("socket hang up"));
      },
    });

    // Mirrors the fallback wiring in streamingHandler.js: pipeWithDisconnect wraps
    // onAbortTerminal with the watchdog's captured abort reason before handing it
    // to createDisconnectAwareStream.
    const abortMessage = "upstream connection lost";
    const onAbortTerminal = () => buildStreamErrorBytes(HTTP_STATUS.GATEWAY_TIMEOUT, abortMessage, FORMATS.OLLAMA);

    const out = createDisconnectAwareStream(
      { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      makeController(),
      onAbortTerminal,
    );

    const text = await readAll(out);
    expect(text).toContain('"error"');
    expect(text).toContain(abortMessage);
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });
});
