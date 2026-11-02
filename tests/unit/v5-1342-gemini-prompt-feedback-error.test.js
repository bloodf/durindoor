// #1342: a Gemini promptFeedback frame with a nested error is an error terminal,
// not a content filter, and the persisted upstreamError copy is redacted.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

const { saveRequestDetail, saveRequestUsage } = await import("@/lib/usageDb.js");
const { buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { initState, translateResponse } = await import("../../open-sse/translator/index.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { OPENAI_FINISH } = await import("../../open-sse/translator/schema/index.js");
const { createUpstreamTerminalTracker, isCoherentNonStreamingResponse } = await import("../../open-sse/utils/streamTerminal.js");

const SENTINEL = "sk-test-FAKE1342abcdef0123456789";
const SELECTED = "fixture-selected-credential-1342";
const promptFeedbackError = {
  promptFeedback: {
    blockReason: "OTHER",
    error: { code: 500, status: "INTERNAL", message: `backend failed ${SENTINEL} Bearer fixture-bearer-1342` },
  },
};

function translate(sourceFormat) {
  const state = initState(sourceFormat);
  const live = translateResponse(FORMATS.GEMINI, sourceFormat, promptFeedbackError, state) || [];
  const flushed = translateResponse(FORMATS.GEMINI, sourceFormat, null, state) || [];
  return [...live, ...flushed].filter(Boolean);
}

describe("#1342 Gemini promptFeedback with a nested error", () => {
  it("ends an OpenAI Chat client with finish_reason error, not content_filter", () => {
    const finishes = translate(FORMATS.OPENAI).flatMap((chunk) => chunk.choices || [])
      .map((choice) => choice.finish_reason).filter(Boolean);
    expect(finishes).toEqual([OPENAI_FINISH.ERROR]);
  });

  it("ends a Claude client with a redacted error event", () => {
    const events = translate(FORMATS.CLAUDE);
    const errors = events.filter((event) => event.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toContain("[redacted]");
    expect(JSON.stringify(events)).not.toContain(SENTINEL);
    expect(JSON.stringify(events)).not.toContain("fixture-bearer-1342");
    expect(events.some((event) => event.delta?.stop_reason)).toBe(false);
  });

  it("redacts upstream text in the Chat→Claude finish_reason error event", () => {
    const state = initState(FORMATS.CLAUDE);
    state.upstreamError = promptFeedbackError.promptFeedback.error;
    const chunk = (delta, finish) => ({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
    const events = [
      ...translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk({ role: "assistant" }, null), state) || [],
      ...translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk({}, OPENAI_FINISH.ERROR), state) || [],
    ];
    const errors = events.filter((event) => event?.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toContain("[redacted]");
    expect(JSON.stringify(events)).not.toContain(SENTINEL);
  });

  it("ends a Responses client with response.failed, not incomplete", () => {
    const events = translate(FORMATS.OPENAI_RESPONSES);
    const terminals = events.map((event) => event.event).filter((name) => /^response\.(completed|incomplete|failed)$/.test(name));
    expect(terminals).toEqual(["response.failed"]);
    expect(JSON.stringify(events)).not.toContain(SENTINEL);
  });

  it("is a failed raw terminal, never a coherent prompt-block success", () => {
    const onCoherentTerminal = vi.fn();
    const tracker = createUpstreamTerminalTracker({ format: FORMATS.GEMINI, onCoherentTerminal });
    tracker.observe({ chunk: promptFeedbackError });
    expect(tracker.outcome).toBe("failure");
    expect(onCoherentTerminal).not.toHaveBeenCalled();
    expect(isCoherentNonStreamingResponse(promptFeedbackError, FORMATS.GEMINI)).toBe(false);
    expect(isCoherentNonStreamingResponse({ promptFeedback: { blockReason: "SAFETY" } }, FORMATS.GEMINI)).toBe(true);
  });
});

describe("#1342 persisted stream upstreamError is redacted", () => {
  beforeEach(() => {
    saveRequestDetail.mockClear();
    saveRequestUsage.mockClear();
  });

  it("redacts credential-like and selected credential text before saving request details", () => {
    const upstreamError = { type: "server_error", code: "fixture_1342", message: `boom ${SENTINEL} ${SELECTED}` };
    buildOnStreamComplete({
      provider: "gemini",
      model: "gemini-fixture",
      connectionId: "connection",
      requestStartTime: 1000,
      body: { input: "hi" },
      stream: true,
      credentials: { apiKey: SELECTED },
      log: { line: vi.fn(), warn: vi.fn() },
    }).onStreamComplete({ content: "", upstreamError }, { prompt_tokens: 3, completion_tokens: 0 }, 1005, null);

    const persisted = JSON.stringify([saveRequestDetail.mock.calls, saveRequestUsage.mock.calls]);
    expect(persisted).not.toContain(SENTINEL);
    expect(persisted).not.toContain(SELECTED);
    const detail = saveRequestDetail.mock.calls[0][0];
    expect(detail.status).toBe("error");
    expect(detail.response.error).toMatchObject({ type: "server_error", code: "fixture_1342" });
    expect(detail.response.error.message).toContain("[redacted]");
    expect(detail.response.content).toContain("[redacted]");
    // The caller's raw diagnostic object is not mutated.
    expect(upstreamError.message).toContain(SENTINEL);
  });
});

describe("#1342 Gemini nested error through the real translated stream", () => {
  const OPAQUE = "opaque-selected-1342-ζ";
  const credentials = { apiKey: OPAQUE };

  beforeEach(() => {
    saveRequestDetail.mockClear();
    saveRequestUsage.mockClear();
  });

  async function run(sourceFormat, frame) {
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "gemini",
      model: "gemini-fixture",
      connectionId: "connection",
      requestStartTime: Date.now(),
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      log: { line: vi.fn(), warn: vi.fn() },
    });
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));
        controller.close();
      },
    });
    const output = input.pipeThrough(createSSETransformStreamWithLogger(
      FORMATS.GEMINI, sourceFormat, "gemini", null, null, "gemini-fixture", "connection", null, onStreamComplete,
      null, "off", null, null, credentials,
    ));
    return new Response(output).text();
  }

  it.each([
    ["plain promptFeedback", (error) => ({ promptFeedback: { blockReason: "OTHER", error } })],
    ["Antigravity-wrapped promptFeedback", (error) => ({ response: { promptFeedback: { blockReason: "OTHER", error } } })],
    ["Antigravity-wrapped response.error", (error) => ({ response: { error } })],
  ])("records %s as an error and redacts opaque credentials on the Claude wire", async (_label, build) => {
    const frame = { ...build({ code: 500, status: "INTERNAL", message: `backend failed ${OPAQUE}` }), usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 0, totalTokenCount: 3 } };
    const wire = await run(FORMATS.CLAUDE, frame);
    expect(wire).not.toContain(OPAQUE);
    expect(wire).toContain('"type":"error"');
    expect(wire).toContain("[redacted]");

    const detail = saveRequestDetail.mock.calls.at(-1)[0];
    expect(detail.status).toBe("error");
    expect(JSON.stringify(detail)).not.toContain(OPAQUE);
    expect(saveRequestUsage).toHaveBeenCalled();
    expect(saveRequestUsage.mock.calls.at(-1)[0].status).toBe("error");
  });
});
