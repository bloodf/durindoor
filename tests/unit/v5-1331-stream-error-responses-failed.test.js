/**
 * #1331 reachability: Chat→Responses stream `finish_reason: "error"` through
 * the real SSE translate path (`createSSETransformStreamWithLogger`).
 *
 * Top-level `chunk.error` is short-circuited inside stream.js (owned by that
 * file / not edited here) via `formatTranslatedStreamError`. This test uses
 * finish_reason alone so the live path reaches translator `sendTerminal`.
 */
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_FINISH } from "../../open-sse/translator/schema/index.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();
const FAILED_FALLBACK_MESSAGE = "Upstream aborted the response (finish_reason error)";

async function pipeText(transform, chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(source.pipeThrough(transform)).text();
}

function parseSseEvents(text) {
  return text.split("\n\n").filter(Boolean).map((block) => {
    const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
    const event = eventLine ? eventLine.slice("event: ".length).trim() : null;
    let data = null;
    if (dataLine) {
      const raw = dataLine.slice("data: ".length).trim();
      if (raw && raw !== "[DONE]") {
        try { data = JSON.parse(raw); } catch { data = raw; }
      } else {
        data = raw;
      }
    }
    return { event, data };
  });
}

describe("#1331 Chat→Responses stream error via SSE transform", () => {
  it("emits exactly one response.failed through the live translate stream", async () => {
    const onComplete = vi.fn();
    // createSSETransformStreamWithLogger(providerFormat, clientFormat, ...)
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "openai",
      null,
      null,
      "gpt-test",
      "connection-1331",
      { messages: [{ role: "user", content: "hi" }] },
      onComplete,
      "sk-test",
    );

    const text = await pipeText(transform, [
      `data: ${JSON.stringify({
        id: "chatcmpl-1331",
        model: "gpt-test",
        choices: [{ index: 0, delta: { content: "boom" }, finish_reason: null }],
      })}\n\n`,
      // finish_reason alone — no top-level `error` (that path is owned by stream.js).
      `data: ${JSON.stringify({
        id: "chatcmpl-1331",
        model: "gpt-test",
        choices: [{ index: 0, delta: {}, finish_reason: OPENAI_FINISH.ERROR }],
      })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    const events = parseSseEvents(text);
    const terminals = events.filter((entry) =>
      ["response.completed", "response.incomplete", "response.failed"].includes(entry.event)
    );
    expect(terminals.map((entry) => entry.event)).toEqual(["response.failed"]);
    expect(terminals[0].data.type).toBe("response.failed");
    expect(terminals[0].data.response.status).toBe("failed");
    expect(terminals[0].data.response.error).toEqual({
      type: "server_error",
      code: "server_error",
      message: FAILED_FALLBACK_MESSAGE,
    });
    expect(events.some((entry) => entry.event === "response.completed")).toBe(false);
    expect(events.some((entry) => entry.event === "response.incomplete")).toBe(false);
  });
});
