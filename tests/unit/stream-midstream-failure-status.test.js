// Upstream 9router #4332: a stream that fails after HTTP 200 (an in-stream
// `error` frame or a Responses `response.failed` event) must be recorded as an
// error in request details and usage, not as a successful request.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

const { saveRequestDetail, saveRequestUsage } = await import("@/lib/usageDb.js");
const { buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const SERVER_ERROR = {
  type: "error",
  error: { type: "server_error", code: "server_error", message: "An error occurred while processing your request." },
  sequence_number: 2,
};

const FAILED_RESPONSE = {
  type: "response.failed",
  response: {
    id: "resp_1",
    status: "failed",
    error: { code: "server_error", message: "An error occurred while processing your request." },
  },
};

const CREATED = { type: "response.created", response: { id: "resp_1", status: "in_progress" } };

function sse(events) {
  return events.map(([event, data]) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`).join("");
}

async function runTranslate(targetFormat, sourceFormat, text) {
  const onStreamComplete = vi.fn();
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const output = input.pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, sourceFormat, "codex", null, null, "gpt-5", null, null, onStreamComplete),
  );
  const clientText = await new Response(output).text();
  return { onStreamComplete, clientText };
}

describe("translate-mode streams hand a mid-stream failure to onStreamComplete", () => {
  it("reports an `error` frame followed by response.failed", async () => {
    const { onStreamComplete } = await runTranslate(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      sse([["response.created", CREATED], ["error", SERVER_ERROR], ["response.failed", FAILED_RESPONSE]]) + "data: [DONE]\n\n",
    );

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toMatchObject({
      type: "server_error",
      message: "An error occurred while processing your request.",
    });
  });

  it("reports a lone response.failed translated for a Chat Completions client", async () => {
    const { onStreamComplete, clientText } = await runTranslate(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      sse([["response.created", CREATED], ["response.failed", FAILED_RESPONSE]]),
    );

    // The client still gets the translator's error chunk, unchanged.
    expect(clientText).toContain("[Error] An error occurred while processing your request.");
    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toMatchObject({ code: "server_error" });
  });

  it("reports no error for a stream that completes normally", async () => {
    const { onStreamComplete } = await runTranslate(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      sse([["response.created", CREATED], ["response.completed", { type: "response.completed", response: { id: "resp_1", status: "completed" } }]]),
    );

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(onStreamComplete.mock.calls[0][0].upstreamError).toBeUndefined();
  });
});

describe("buildOnStreamComplete records a mid-stream failure as an error", () => {
  beforeEach(() => {
    saveRequestDetail.mockClear();
    saveRequestUsage.mockClear();
  });

  function complete(contentObj) {
    buildOnStreamComplete({
      provider: "codex",
      model: "gpt-5",
      connectionId: "connection",
      requestStartTime: 1000,
      body: { input: "hi" },
      stream: true,
      log: { line: vi.fn(), warn: vi.fn() },
    }).onStreamComplete(contentObj, { prompt_tokens: 3, completion_tokens: 0 }, 1005, null);
  }

  it("writes status error with the upstream message", () => {
    complete({ content: "", upstreamError: { type: "server_error", code: "server_error", message: "boom" } });

    const detail = saveRequestDetail.mock.calls[0][0];
    expect(detail.status).toBe("error");
    expect(detail.response.content).toBe("[Streaming failed: boom]");
    expect(detail.response.error).toEqual({ type: "server_error", code: "server_error", message: "boom" });
    expect(saveRequestUsage.mock.calls[0][0].status).toBe("error");
  });

  it("keeps partial content produced before the failure", () => {
    complete({ content: "partial answer", upstreamError: { message: "boom" } });

    const detail = saveRequestDetail.mock.calls[0][0];
    expect(detail.status).toBe("error");
    expect(detail.response.content).toBe("partial answer");
  });

  it("still writes success for a clean stream", () => {
    complete({ content: "hello" });

    const detail = saveRequestDetail.mock.calls[0][0];
    expect(detail.status).toBe("success");
    expect(detail.response.error).toBeUndefined();
    expect(saveRequestUsage.mock.calls[0][0].status).toBeUndefined();
  });
});
