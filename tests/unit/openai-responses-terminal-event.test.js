import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { buildAbortedResponsesTerminalBytes, formatIncompleteOpenAIResponsesStreamFailure } from "../../open-sse/utils/responsesStreamHelpers.js";

async function readOutput(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function sourceStream(input) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
}

function parseFailure(output) {
  const data = output.match(/event: response\.failed\ndata: ([^\n]+)/)?.[1];
  expect(data).toBeDefined();
  return JSON.parse(data).response;
}

function runTransform(input) {
  return readOutput(sourceStream(input).pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-5.5",
    ),
  ));
}

function runPassthrough(input, responsesStreamState = null) {
  return readOutput(sourceStream(input).pipeThrough(
    createPassthroughStreamWithLogger(
      "codex",
      null,
      null,
      "gpt-5.5",
      null,
      { stream: true },
      null,
      null,
      FORMATS.OPENAI_RESPONSES,
      null,
      null,
      responsesStreamState,
    ),
  ));
}

async function runAbortedPassthroughChunks(chunks) {
  const encoder = new TextEncoder();
  let chunkIndex = 0;
  const providerResponse = new Response(new ReadableStream({
    async pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex++]));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.error(new Error("stream stall timeout"));
      }
    },
  }), { headers: { "content-type": "text/event-stream" } });
  let connected = true;
  const result = await handleStreamingResponse({
    providerResponse,
    provider: "codex",
    model: "gpt-5.5",
    sourceFormat: FORMATS.OPENAI_RESPONSES,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    body: { stream: true },
    stream: true,
    requestStartTime: Date.now(),
    streamController: {
      signal: new AbortController().signal,
      startTime: Date.now(),
      isConnected: () => connected,
      handleActivity: () => {},
      handleComplete: () => { connected = false; },
      handleError: () => { connected = false; },
      handleDisconnect: () => { connected = false; },
      abort: () => { connected = false; },
    },
  });

  return result.response.text();
}

describe("OpenAI Responses streaming termination", () => {
  it("emits a response.failed event when a Responses stream closes before a terminal event", async () => {
    const output = await runTransform([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
      `event: response.output_text.delta`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.failed");
    expect(output).toContain('"type":"response.failed"');
    expect(output).not.toContain("data: null");
    expect(parseFailure(output).id).toBe("resp_test");
    expect(output).not.toContain("data: [DONE]");
  });

  it("does not add response.failed when a Responses stream already completed", async () => {
    const output = await runTransform([
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("event: response.failed");
    expect(output).not.toContain("data: null");
    expect(output).not.toContain("data: [DONE]");
  });

  it("does not add response.failed when a Responses stream sends response.done", async () => {
    const output = await runTransform([
      `event: response.done`,
      `data: ${JSON.stringify({ type: "response.done", response: { id: "resp_test" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.done");
    expect(output).not.toContain("event: response.failed");
    expect(output).not.toContain("data: null");
    expect(output).not.toContain("data: [DONE]");
  });

  it("emits response.failed before DONE when a Responses stream sends DONE without a terminal event", async () => {
    const output = await runTransform([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"));

    expect(output.indexOf("event: response.failed")).toBeLessThan(output.indexOf("data: [DONE]"));
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(output).not.toContain("data: null");
    expect(parseFailure(output).id).toBe("resp_test");
  });

  it("retains the created response ID when passthrough recovery synthesizes failure", async () => {
    const output = await runPassthrough([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
      `event: response.output_text.delta`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}`,
      "",
    ].join("\n"));

    expect(parseFailure(output).id).toBe("resp_test");
  });

  it("retains a response ID when response.created is identified by payload type", async () => {
    const output = await runPassthrough([
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
    ].join("\n"));

    expect(parseFailure(output).id).toBe("resp_test");
  });

  it("retains the created response ID when an upstream abort synthesizes failure", async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const providerResponse = new Response(new ReadableStream({
      pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          controller.enqueue(encoder.encode([
            "event: response.created",
            `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
            "",
            "",
          ].join("\n")));
        } else {
          controller.error(new Error("stream stall timeout"));
        }
      },
    }), { headers: { "content-type": "text/event-stream" } });
    let connected = true;
    const result = await handleStreamingResponse({
      providerResponse,
      provider: "codex",
      model: "gpt-5.5",
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      body: { stream: true },
      stream: true,
      requestStartTime: Date.now(),
      streamController: {
        signal: new AbortController().signal,
        startTime: Date.now(),
        isConnected: () => connected,
        handleActivity: () => {},
        handleComplete: () => { connected = false; },
        handleError: () => { connected = false; },
        handleDisconnect: () => { connected = false; },
        abort: () => { connected = false; },
      },
    });

    expect(parseFailure(await result.response.text()).id).toBe("resp_test");
  });

  it("does not synthesize failure after a completed response aborts", async () => {
    const responsesStreamState = {};
    const input = [
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
      "",
      "",
    ].join("\n");

    await runPassthrough(input, responsesStreamState);

    expect(buildAbortedResponsesTerminalBytes(responsesStreamState)).toBeNull();
  });

  it("keeps a completed response terminal when its trailing delimiter is split before abort", async () => {
    const output = await runAbortedPassthroughChunks([
      [
        "event: response.completed",
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
        "",
      ].join("\n"),
      "\n",
    ]);

    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("event: response.failed");
    expect(output).not.toContain("data: [DONE]");
  });

  it("keeps a completed response terminal followed by one split DONE before abort", async () => {
    const output = await runAbortedPassthroughChunks([
      [
        "event: response.completed",
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
        "",
        "",
      ].join("\n"),
      "data: [DO",
      "NE]\n\n",
    ]);

    expect(output).not.toContain("event: response.failed");
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("recovers when partial illegal data arrives after a completed response before abort", async () => {
    const output = await runAbortedPassthroughChunks([
      [
        "event: response.completed",
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
        "",
        "",
      ].join("\n"),
      `data: {"type":"response.output_text.delta"`,
    ]);

    expect(parseFailure(output).id).toBe("resp_test");
    expect(output).toContain("data: [DONE]");
  });

  it.each([
    ["contradictory terminal", [
      "event: response.created",
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.failed", response: { id: "resp_test", status: "failed" } })}`,
      "",
    ].join("\n")],
    ["post-terminal frame", [
      "event: response.created",
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
      "",
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "late" })}`,
      "",
    ].join("\n")],
  ])("keeps abort recovery authoritative after a %s", async (_label, input) => {
    const responsesStreamState = {};
    await runPassthrough(input, responsesStreamState);

    const recovery = new TextDecoder().decode(buildAbortedResponsesTerminalBytes(responsesStreamState));
    expect(parseFailure(recovery).id).toBe("resp_test");
    expect(recovery).toContain("data: [DONE]");
  });

  it("does not generate a fallback when an existing response ID is available", () => {
    const now = vi.spyOn(Date, "now");

    expect(parseFailure(formatIncompleteOpenAIResponsesStreamFailure("resp_test")).id).toBe("resp_test");
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("generates a fallback response ID when no created ID was observed", () => {
    const response = parseFailure(formatIncompleteOpenAIResponsesStreamFailure());

    expect(response.id).toMatch(/^resp_\d+$/);
  });
});
