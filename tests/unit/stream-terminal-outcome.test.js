import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createUpstreamTerminalTracker } from "../../open-sse/utils/streamTerminal.js";
import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../open-sse/utils/stream.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();

async function pipeText(transform, chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(source.pipeThrough(transform)).text();
}

describe("raw upstream terminal outcomes", () => {
  it("requires every requested OpenAI choice and keeps failures sticky", () => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({
      format: FORMATS.OPENAI,
      expectedChoiceCount: 2,
      onCoherentTerminal: terminal,
    });
    tracker.observe({ chunk: { choices: [{ index: 0, finish_reason: "stop" }] } });
    expect(terminal).not.toHaveBeenCalled();
    tracker.observe({ chunk: { choices: [{ index: 1, finish_reason: "error" }] } });
    tracker.observe({ rawDone: true });
    expect(tracker.outcome).toBe("failure");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("does not let an OpenAI error followed by DONE clear fallback state", () => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({ format: FORMATS.OPENAI, onCoherentTerminal: terminal });
    tracker.observe({ chunk: { type: "error", error: { message: "failed" } } });
    tracker.observe({ rawDone: true });
    expect(tracker.outcome).toBe("failure");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("does not treat an empty OpenAI DONE sentinel as a coherent response", () => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({ format: FORMATS.OPENAI, onCoherentTerminal: terminal });
    tracker.observe({ rawDone: true });
    expect(tracker.outcome).toBe("failure");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("allows only the OpenAI usage trailer between finish and DONE", () => {
    const tracker = createUpstreamTerminalTracker({ format: FORMATS.OPENAI });
    tracker.observe({ chunk: { choices: [{ index: 0, finish_reason: "stop" }] } });
    tracker.observe({ chunk: { choices: [], usage: { total_tokens: 3 } } });
    tracker.observe({ rawDone: true });
    expect(tracker.outcome).toBe("success");

    const lateData = createUpstreamTerminalTracker({ format: FORMATS.OPENAI });
    lateData.observe({ chunk: { choices: [{ index: 0, finish_reason: "stop" }] } });
    lateData.observe({ rawDone: true });
    lateData.observe({ chunk: { choices: [{ index: 0, delta: { content: "late" }, finish_reason: null }] } });
    expect(lateData.outcome).toBe("failure");
  });

  it("keeps an OpenAI failure sticky after finish_reason and before DONE", () => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({ format: FORMATS.OPENAI, onCoherentTerminal: terminal });
    tracker.observe({ chunk: { choices: [{ index: 0, finish_reason: "stop" }] } });
    tracker.observe({ chunk: { error: { message: "late failure" } } });
    tracker.observe({ rawDone: true });
    expect(tracker.outcome).toBe("failure");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("rejects post-terminal data for validated special formats", () => {
    for (const format of [FORMATS.KIRO, FORMATS.COMMANDCODE, FORMATS.CURSOR]) {
      const tracker = createUpstreamTerminalTracker({ format, deferSuccessCallback: true });
      tracker.observe({ chunk: { choices: [{ index: 0, finish_reason: "stop" }] } });
      tracker.observe({ chunk: { choices: [{ index: 0, delta: { content: "late" }, finish_reason: null }] } });
      tracker.observe({ rawDone: true });
      tracker.finalize();
      expect(tracker.outcome).toBe("failure");
    }
  });

  it("keeps malformed nonempty SSE data sticky before DONE", async () => {
    const terminal = vi.fn();
    const sse = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "data: {malformed-provider-frame",
      "data: [DONE]",
      "",
    ].join("\n\n");
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI, terminal,
    );
    await pipeText(transform, [sse]);
    expect(terminal).not.toHaveBeenCalled();
    expect(parseSSEToOpenAIResponse(sse, "gpt-test")).toBeNull();
  });

  it.each([
    [FORMATS.CLAUDE, { type: "message_stop" }, null],
    [FORMATS.OPENAI_RESPONSES, { type: "response.completed", response: { status: "completed" } }, "response.completed"],
    [FORMATS.OPENAI_RESPONSES, { type: "response.incomplete", response: { status: "incomplete" } }, "response.incomplete"],
    [FORMATS.GEMINI, { candidates: [{ index: 0, finishReason: "STOP" }] }, null],
    [FORMATS.GEMINI, { promptFeedback: { blockReason: "SAFETY" } }, null],
    [FORMATS.OLLAMA, { done: true }, null],
    [FORMATS.COMMANDCODE, { type: "finish" }, null],
  ])("recognizes coherent %s terminals", (format, chunk, eventName) => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({ format, onCoherentTerminal: terminal });
    tracker.observe({ chunk, eventName });
    expect(tracker.outcome).toBe("success");
    expect(terminal).toHaveBeenCalledTimes(1);
  });

  it.each([
    [FORMATS.CLAUDE, { type: "error", error: { message: "no" } }, null],
    [FORMATS.OPENAI_RESPONSES, { type: "response.failed", response: { status: "failed" } }, "response.failed"],
    [FORMATS.OPENAI_RESPONSES, { type: "response.cancelled", response: { status: "cancelled" } }, "response.cancelled"],
    [FORMATS.GEMINI, { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }, null],
    [FORMATS.GEMINI, { error: { code: "RESOURCE_EXHAUSTED" } }, null],
    [FORMATS.OLLAMA, { error: "failed", done: true }, null],
  ])("rejects explicit %s failures", (format, chunk, eventName) => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({ format, onCoherentTerminal: terminal });
    tracker.observe({ chunk, eventName });
    expect(tracker.outcome).toBe("failure");
    expect(terminal).not.toHaveBeenCalled();
  });

  it.each([
    [FORMATS.OPENAI_RESPONSES, { type: "response.failed", response: { status: "failed" } }, "response.completed"],
    [FORMATS.OPENAI_RESPONSES, { type: "response.output_text.delta", delta: "late" }, "response.completed"],
    [FORMATS.OPENAI_RESPONSES, { response: { status: "incomplete" } }, "response.completed"],
    [FORMATS.CLAUDE, { type: "message_stop" }, "error"],
  ])("rejects contradictory %s event and payload framing", (format, chunk, eventName) => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({ format, onCoherentTerminal: terminal });
    tracker.observe({ chunk, eventName });
    expect(tracker.outcome).toBe("failure");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("lets a later Responses failure override provisional buffered success", () => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({
      format: FORMATS.OPENAI_RESPONSES,
      onCoherentTerminal: terminal,
      deferSuccessCallback: true,
    });
    tracker.observe({
      eventName: "response.completed",
      chunk: { type: "response.completed", response: { status: "completed" } },
    });
    tracker.observe({
      eventName: "response.failed",
      chunk: { type: "response.failed", response: { status: "failed" } },
    });
    tracker.finalize();
    expect(tracker.outcome).toBe("failure");
    expect(terminal).not.toHaveBeenCalled();
  });

  it.each([
    [
      FORMATS.OPENAI_RESPONSES,
      [
        { chunk: { type: "response.completed", response: { status: "completed" } }, eventName: "response.completed" },
        { chunk: { type: "response.output_text.delta", delta: "late" }, eventName: "response.output_text.delta" },
      ],
    ],
    [
      FORMATS.OPENAI_RESPONSES,
      [
        { rawDone: true },
        { chunk: { type: "response.completed", response: { status: "completed" } }, eventName: "response.completed" },
      ],
    ],
    [
      FORMATS.CLAUDE,
      [
        { chunk: { type: "message_stop" }, eventName: "message_stop" },
        { chunk: { type: "content_block_delta", delta: { text: "late" } }, eventName: "content_block_delta" },
      ],
    ],
  ])("keeps post-terminal %s data sticky as failure", (format, observations) => {
    const tracker = createUpstreamTerminalTracker({ format, deferSuccessCallback: true });
    for (const observation of observations) tracker.observe(observation);
    tracker.finalize();
    expect(tracker.outcome).toBe("failure");
  });

  it("waits for every requested Gemini candidate", () => {
    const terminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({
      format: FORMATS.GEMINI,
      expectedCandidateCount: 2,
      onCoherentTerminal: terminal,
    });
    tracker.observe({ chunk: { candidates: [{ index: 0, finishReason: "STOP" }] } });
    expect(terminal).not.toHaveBeenCalled();
    tracker.observe({ chunk: { candidates: [{ index: 1, finishReason: "MAX_TOKENS" }] } });
    expect(terminal).toHaveBeenCalledOnce();
  });

  it("does not treat arbitrary passthrough EOF as success", async () => {
    const terminal = vi.fn();
    const usage = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "conn", {}, usage, null, FORMATS.OPENAI, terminal,
    );
    await pipeText(transform, [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}\n\n`,
    ]);
    expect(usage).toHaveBeenCalledOnce();
    expect(terminal).not.toHaveBeenCalled();
  });

  it("clears once on raw OpenAI completion while usage waits for its trailer", async () => {
    const terminal = vi.fn();
    const usage = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "openai",
      null,
      null,
      "gpt-test",
      "conn",
      { n: 1, messages: [{ role: "user", content: "hi" }] },
      usage,
      null,
      "off",
      terminal,
    );
    await pipeText(transform, [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    expect(terminal).toHaveBeenCalledOnce();
    expect(usage).toHaveBeenCalledOnce();
    expect(usage.mock.calls[0][1]).toMatchObject({ total_tokens: 3 });
  });

  it("tracks a final DONE that has no trailing newline", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "conn", {}, null, null, FORMATS.OPENAI, terminal,
    );
    await pipeText(transform, [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]`,
    ]);
    expect(terminal).toHaveBeenCalledOnce();
  });

  it("synthesizes response.failed for truncated Responses passthrough without clearing", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "codex", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI_RESPONSES, terminal,
    );
    const output = await pipeText(transform, [
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}`,
    ]);
    expect(output).toContain("event: response.failed");
    expect(output).toContain("stream closed before response.completed");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("rejects a Responses event/payload contradiction in live passthrough", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "codex", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI_RESPONSES, terminal,
    );
    const output = await pipeText(transform, [
      `event: response.failed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`,
    ]);
    expect(output).toContain("event: response.failed");
    expect(output).toContain("stream closed before response.completed");
    expect(output).not.toContain("data: [DONE]");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("rejects an embedded Responses error in live passthrough", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "codex", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI_RESPONSES, terminal,
    );
    const output = await pipeText(transform, [
      `event: response.completed\ndata: ${JSON.stringify({
        type: "response.completed",
        response: { status: "completed", error: { message: "boom" } },
      })}\n\n`,
    ]);
    expect(output).toContain("stream closed before response.completed");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("rejects a Claude event/payload contradiction in live passthrough", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "claude", null, null, "claude-test", "conn", {}, null, null,
      FORMATS.CLAUDE, terminal,
    );
    await expect(pipeText(transform, [
      `event: error\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ])).rejects.toThrow("ended before message_stop");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("rejects post-terminal Responses data in live passthrough", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "codex", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI_RESPONSES, terminal,
    );
    const output = await pipeText(transform, [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`,
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "late" })}\n\n`,
    ]);
    expect(output).toContain("stream closed before response.completed");
    expect(output).not.toContain("data: [DONE]");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("rejects an event-labeled DONE sentinel in live Responses passthrough", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "codex", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI_RESPONSES, terminal,
    );
    await pipeText(transform, [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`,
      "event: response.failed\ndata: [DONE]\n\n",
    ]);
    expect(terminal).not.toHaveBeenCalled();
  });

  it("tracks a final Responses terminal without a trailing newline", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "codex", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI_RESPONSES, terminal,
    );
    await pipeText(transform, [
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
    ]);
    expect(terminal).toHaveBeenCalledOnce();
  });

  it("preserves a native incomplete Responses terminal without fabricating failure", async () => {
    const terminal = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-test",
      "conn",
      {},
      null,
      null,
      "off",
      terminal,
    );
    const output = await pipeText(transform, [
      `event: response.incomplete\ndata: ${JSON.stringify({ type: "response.incomplete", response: { status: "incomplete" } })}\n\n`,
    ]);
    expect(output).toContain("event: response.incomplete");
    expect(output).not.toContain("event: response.failed");
    expect(terminal).toHaveBeenCalledOnce();
  });

  it("retains a pending Responses event label for a final buffered data line", async () => {
    const terminal = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "codex", null, null, "gpt-test", "conn", {}, null, null,
      FORMATS.OPENAI_RESPONSES, terminal,
    );
    const output = await pipeText(transform, [
      `event: response.failed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
    ]);
    expect(output).toContain("stream closed before response.completed");
    expect(output).not.toContain("data: [DONE]");
    expect(terminal).not.toHaveBeenCalled();
  });

  it("validates a final buffered Claude event and rejects its reversed contradiction", async () => {
    const validTerminal = vi.fn();
    const valid = createPassthroughStreamWithLogger(
      "claude", null, null, "claude-test", "conn", {}, null, null,
      FORMATS.CLAUDE, validTerminal,
    );
    await pipeText(valid, [
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
    ]);
    expect(validTerminal).toHaveBeenCalledOnce();

    const invalidTerminal = vi.fn();
    const invalid = createPassthroughStreamWithLogger(
      "claude", null, null, "claude-test", "conn", {}, null, null,
      FORMATS.CLAUDE, invalidTerminal,
    );
    await expect(pipeText(invalid, [
      `event: error\ndata: ${JSON.stringify({ type: "message_stop" })}`,
    ])).rejects.toThrow("ended before message_stop");
    expect(invalidTerminal).not.toHaveBeenCalled();
  });

  it("uses translated provider candidate counts before clearing cross-format streams", async () => {
    const terminal = vi.fn();
    const transform = createSSETransformStreamWithLogger(
      FORMATS.GEMINI,
      FORMATS.OPENAI,
      "gemini",
      null,
      null,
      "gemini-test",
      "conn",
      { n: 2, messages: [{ role: "user", content: "hi" }] },
      null,
      null,
      "off",
      terminal,
      { generationConfig: { candidateCount: 2 } },
    );
    await pipeText(transform, [
      `data: ${JSON.stringify({ candidates: [{ index: 0, content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ index: 1, finishReason: "MALFORMED_FUNCTION_CALL" }] })}\n\n`,
    ]);
    expect(terminal).not.toHaveBeenCalled();
  });
});
