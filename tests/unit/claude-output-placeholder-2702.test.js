// Issue #2702: only numeric Claude start output_tokens:1 is provisional.
// Drive the real transform selection, completion/abandonment finalizers and
// captured saveRequestUsage boundary. sourceFormat is the client format;
// targetFormat is the upstream provider format. No provider calls are made.
// Empty estimated output persists as canonical literal zero, not null (ask5).
// Historical pre-fix reproduction notes follow. The translated fixture was
// reversed; the corrected real-path findings are in the linked report.
// Issue #2702 (OmniRoute PR #21336, "native Claude" usage accounting):
// an Anthropic `message_start` frame carries `output_tokens: 1` before any
// output exists. That number is a PLACEHOLDER, not a measurement: the real
// cumulative output arrives in a later `message_delta` receipt.
//
// This file reproduces the placeholder handling end to end through the real
// Claude stream transform (`buildTransformStream` -> Claude passthrough /
// Claude->OpenAI translation), the real stream finalizer
// (`buildOnStreamComplete`) and the captured persistence callback
// (`saveRequestUsage`, mocked at the `@/lib/usageDb.js` boundary). No product
// code is changed here.
//
// Established with the current tree (see
// internal/docs/port-reports/review-claude-output-placeholder.md):
//
//   native Claude client path (Claude -> Claude, passthrough)
//     80 observed chars, no receipt   -> persisted output 20   (estimate)
//     no content, no receipt          -> persisted output 1    (placeholder)
//     explicit final receipt 0        -> persisted output 0    (authoritative)
//     explicit final receipt 5        -> persisted output 5    (authoritative)
//     interrupted snapshot            -> snapshot output 20    (estimate)
//
//   OpenAI client path (Claude upstream -> OpenAI client, translated)
//     80 observed chars, no receipt   -> persisted output 1    (placeholder)
//     explicit final receipt 0 / 5    -> persisted output 0 / 5 (authoritative)
//
// A positive provider measurement is authoritative: only the `message_start`
// placeholder is provisional. The failing expectations below are limited to
// the placeholder cases that are demonstrated to persist today.
// End historical notes. The assertions below use the corrected contract.
import { describe, it, expect, vi, beforeEach } from "vitest";

import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { buildOnStreamComplete, buildTransformStream } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { saveRequestUsage } = await import("@/lib/usageDb.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { extractUsage, mergeUsage, isProvisionalOutput, refreshProvisionalOutput, resolveProvisionalOutput } = await import("../../open-sse/utils/usageTracking.js");

// A real Anthropic Messages stream: `message_start` carries the input/cache
// counters plus the placeholder output count, `message_delta` carries the
// authoritative cumulative output receipt.
const START = {
  type: "message_start",
  message: {
    id: "msg_2702",
    type: "message",
    role: "assistant",
    model: "claude-probe",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 },
  },
};
const BLOCK_START = { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
// 80 observed characters: 80 / 4 = 20 estimated output tokens.
const TEXT = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x".repeat(80) } };
const BLOCK_STOP = { type: "content_block_stop", index: 0 };
const STOP = { type: "message_stop" };
const receipt = (output_tokens) => ({
  type: "message_delta",
  delta: { stop_reason: "end_turn", stop_sequence: null },
  usage: { output_tokens },
});

const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const CONTEXT = {
  provider: "anthropic",
  model: "claude-probe",
  connectionId: "connection-12345678",
  requestStartTime: Date.now(),
  body: { model: "claude-probe", messages: [{ role: "user", content: "hi" }] },
  stream: true,
  clientRawRequest: { endpoint: "/v1/messages" },
};

beforeEach(() => {
  saveRequestUsage.mockClear();
});

/**
 * Drive the real Claude stream transform and finalizer, then return the usage
 * row the persistence callback received.
 */
async function persistedTokens(targetFormat, events) {
  const { onStreamComplete } = buildOnStreamComplete(CONTEXT);
  const { stream, emittedFormat } = buildTransformStream({
    provider: "anthropic",
    sourceFormat: targetFormat,
    targetFormat: FORMATS.CLAUDE,
    userAgent: "claude-probe",
    model: CONTEXT.model,
    connectionId: CONTEXT.connectionId,
    body: CONTEXT.body,
    onStreamComplete,
  });
  expect(emittedFormat).toBe(targetFormat);
  const payload = events.map(frame).join("");
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  await new Response(input.pipeThrough(stream)).text();
  expect(saveRequestUsage).toHaveBeenCalledTimes(1);
  return saveRequestUsage.mock.calls[0][0].tokens;
}

describe("Claude stream: message_start output placeholder (#2702)", () => {
  describe("native Claude client path (Claude -> Claude)", () => {
    it("persists the observed-content estimate when no final receipt arrives", async () => {
      const tokens = await persistedTokens(FORMATS.CLAUDE, [START, BLOCK_START, TEXT, BLOCK_STOP, STOP]);
      // 80 observed characters estimate 20 output tokens; the placeholder is gone.
      expect(tokens).toMatchObject({
        prompt_tokens: 15,
        completion_tokens: 20,
        cached_tokens: 2,
        cache_creation_input_tokens: 3,
      });
    });

    it("persists the authoritative final output receipt (0) and keeps the input and cache counters", async () => {
      const tokens = await persistedTokens(FORMATS.CLAUDE, [START, BLOCK_START, TEXT, BLOCK_STOP, receipt(0), STOP]);
      // An explicit zero is a measurement, not a missing receipt.
      expect(tokens).toMatchObject({
        prompt_tokens: 15,
        completion_tokens: 0,
        cached_tokens: 2,
        cache_creation_input_tokens: 3,
      });
    });

    it("persists the authoritative final output receipt (5) and keeps the input and cache counters", async () => {
      const tokens = await persistedTokens(FORMATS.CLAUDE, [START, BLOCK_START, TEXT, BLOCK_STOP, receipt(5), STOP]);
      // A positive provider measurement is authoritative, not a placeholder.
      expect(tokens).toMatchObject({
        prompt_tokens: 15,
        completion_tokens: 5,
        cached_tokens: 2,
        cache_creation_input_tokens: 3,
      });
    });

    it("does not persist the message_start placeholder as measured output without content or a receipt", async () => {
      const tokens = await persistedTokens(FORMATS.CLAUDE, [START, STOP]);
      // Historical pre-fix interpretation, retained for review:
      // Today this persists completion_tokens 1: the `message_start` placeholder.
      // With no content observed and no final receipt, the output count is unknown.
      // Canonical storage uses literal zero for empty estimated output (ask5).
      expect(tokens.completion_tokens).toBe(0);
    });

    it("keeps the observed-content estimate in an interrupted snapshot", async () => {
      const { stream } = buildTransformStream({
        provider: "anthropic",
        sourceFormat: FORMATS.CLAUDE,
        targetFormat: FORMATS.CLAUDE,
        userAgent: "claude-probe",
        model: CONTEXT.model,
        connectionId: CONTEXT.connectionId,
        body: CONTEXT.body,
        onStreamComplete: vi.fn(),
      });
      const payload = [START, BLOCK_START, TEXT, BLOCK_STOP].map(frame).join("");
      const input = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
        },
      });
      const reader = input.pipeThrough(stream).getReader();
      await reader.read();
      // The interrupted path refreshes the placeholder to the observed estimate.
      expect(stream.getStreamSnapshot().usage).toMatchObject({
        prompt_tokens: 10,
        completion_tokens: 20,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 3,
      });
      void reader.cancel();
    });
  });

  describe("OpenAI client path (Claude upstream -> OpenAI client)", () => {
    it("does not persist the message_start placeholder when content was observed", async () => {
      const tokens = await persistedTokens(FORMATS.OPENAI, [START, BLOCK_START, TEXT, BLOCK_STOP, STOP]);
      // Historical observation from the reversed fixture, retained for review:
      // Today this persists completion_tokens 1 even though 80 characters
      // arrived; the translated finalizer does not refresh the placeholder.
      // 80 observed characters use the existing four-character estimate.
      expect(tokens.completion_tokens).toBe(20);
    });

    it.each([0, 5])("persists the authoritative final output receipt (%i)", async (output_tokens) => {
      const tokens = await persistedTokens(FORMATS.OPENAI, [START, BLOCK_START, TEXT, BLOCK_STOP, receipt(output_tokens), STOP]);
      expect(tokens.completion_tokens).toBe(output_tokens);
    });
  });
});

describe.each([FORMATS.CLAUDE, FORMATS.OPENAI])("#2702 final accounting: %s client", (format) => {
  const startWith = (output_tokens) => ({ ...START, message: { ...START.message, usage: { ...START.message.usage, output_tokens } } });

  it.each([0, 1, 5])("keeps final measured output %i", async (count) => {
    const tokens = await persistedTokens(format, [START, BLOCK_START, TEXT, BLOCK_STOP, receipt(count), STOP]);
    expect(tokens.completion_tokens).toBe(count);
    expect(tokens).toMatchObject({ prompt_tokens: 15, cached_tokens: 2, cache_creation_input_tokens: 3 });
  });

  it.each([0, 5, 80])("never estimates over initial measured output %i", async (count) => {
    const tokens = await persistedTokens(format, [startWith(count), BLOCK_START, TEXT, BLOCK_STOP, STOP]);
    expect(tokens.completion_tokens).toBe(count);
    expect(tokens).toMatchObject({ prompt_tokens: 15, cached_tokens: 2, cache_creation_input_tokens: 3 });
  });

  it("estimates empty provisional output as canonical zero", async () => {
    const tokens = await persistedTokens(format, [START, STOP]);
    expect(tokens.completion_tokens).toBe(0);
    expect(tokens).toMatchObject({ prompt_tokens: 15, cached_tokens: 2, cache_creation_input_tokens: 3 });
  });

  it("keeps output provisional across an output-absent receipt", async () => {
    const tokens = await persistedTokens(format, [START, BLOCK_START, TEXT, BLOCK_STOP, receipt(undefined), STOP]);
    expect(tokens.completion_tokens).toBe(20);
  });

  it.each(["thinking_delta", "input_json_delta"])("estimates %s without text", async (type) => {
    const tool = type === "input_json_delta";
    const block = { type: "content_block_start", index: 0, content_block: tool
      ? { type: "tool_use", id: "tool_2702", name: "lookup", input: {} }
      : { type: "thinking", thinking: "" } };
    const delta = { type: "content_block_delta", index: 0, delta: { type, [tool ? "partial_json" : "thinking"]: tool ? JSON.stringify({ q: "x".repeat(72) }) : "x".repeat(80) } };
    const tokens = await persistedTokens(format, [START, block, delta, BLOCK_STOP, STOP]);
    // Existing estimator floors (80 payload chars + 6 name chars) / 4.
    expect(tokens.completion_tokens).toBe(tool ? 21 : 20);
    expect(tokens).toMatchObject({ prompt_tokens: 15, cached_tokens: 2, cache_creation_input_tokens: 3 });
  });

  it.each([0, 1, 5])("snapshot does not consume provisional status before final receipt %i", async (count) => {
    const { onStreamComplete } = buildOnStreamComplete(CONTEXT);
    const { stream } = buildTransformStream({
      provider: "anthropic", sourceFormat: format, targetFormat: FORMATS.CLAUDE,
      model: CONTEXT.model, connectionId: CONTEXT.connectionId, body: CONTEXT.body, onStreamComplete,
    });
    const writer = stream.writable.getWriter();
    const output = new Response(stream.readable).text();
    await writer.write(new TextEncoder().encode([START, BLOCK_START, TEXT, BLOCK_STOP].map(frame).join("")));
    const snapshot = stream.getStreamSnapshot();
    expect(snapshot.usage).toMatchObject({ completion_tokens: 20, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 });
    expect(stream.getStreamSnapshot().usage).toEqual(snapshot.usage);
    expect(saveRequestUsage).not.toHaveBeenCalled();
    await writer.write(new TextEncoder().encode([receipt(count), STOP].map(frame).join("")));
    await writer.close();
    await output;
    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(saveRequestUsage.mock.calls[0][0].tokens.completion_tokens).toBe(count);
    expect(snapshot.usage.completion_tokens).toBe(20);
  });

  it("does not reopen resolved output after a repeated start and output-absent receipt", async () => {
    const tokens = await persistedTokens(format, [START, BLOCK_START, TEXT, BLOCK_STOP, receipt(0), START, receipt(undefined), STOP]);
    expect(tokens.completion_tokens).toBe(0);
  });

  it("persists an interrupted snapshot once through the real abandonment finalizer", async () => {
    const { onStreamComplete, onStreamAbandoned } = buildOnStreamComplete(CONTEXT);
    const { stream } = buildTransformStream({
      provider: "anthropic", sourceFormat: format, targetFormat: FORMATS.CLAUDE,
      model: CONTEXT.model, connectionId: CONTEXT.connectionId, body: CONTEXT.body, onStreamComplete,
    });
    const writer = stream.writable.getWriter();
    const output = new Response(stream.readable).text().catch(() => {});
    await writer.write(new TextEncoder().encode([START, BLOCK_START, TEXT, BLOCK_STOP].map(frame).join("")));
    const snapshot = stream.getStreamSnapshot();
    onStreamAbandoned("client_disconnect", snapshot);
    onStreamAbandoned("client_disconnect", snapshot);
    await writer.abort();
    await output;
    onStreamComplete(snapshot, snapshot.usage, snapshot.ttftAt);
    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(saveRequestUsage.mock.calls[0][0].tokens).toMatchObject({
      prompt_tokens: 15, completion_tokens: 20, cached_tokens: 2, cache_creation_input_tokens: 3,
    });
  });
});

it("resolves idempotently while projections preserve the raw receipt and provisional state", () => {
  const usage = extractUsage(START);
  const snapshot = refreshProvisionalOutput(usage, 80);
  expect(usage.completion_tokens).toBe(1);
  expect(isProvisionalOutput(usage)).toBe(true);
  expect(isProvisionalOutput(snapshot)).toBe(true);
  const resolved = resolveProvisionalOutput(usage, 80);
  expect(resolved.completion_tokens).toBe(20);
  expect(isProvisionalOutput(resolved)).toBe(false);
  expect(resolveProvisionalOutput(resolved, 400)).toBe(resolved);
  expect(mergeUsage(resolved, extractUsage(START)).completion_tokens).toBe(20);
  expect(START.message.usage.output_tokens).toBe(1);
  expect(mergeUsage(snapshot, extractUsage(receipt(0))).completion_tokens).toBe(0);
});
