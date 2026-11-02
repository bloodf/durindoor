import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const encoder = new TextEncoder();
const credentials = {
  apiKey: "fixture-nested-selected-é門🔐",
  providerSpecificData: { sessionToken: "fixture-nested-session-界🗝" },
};
const secretTokens = [
  credentials.apiKey,
  credentials.providerSpecificData.sessionToken,
  "fixture-nested-private-bearer",
  "/home/fixture/nested-private.ts",
];
const upstreamError = {
  message: `拒否 café 🚪 ${credentials.apiKey} ${credentials.providerSpecificData.sessionToken} /home/fixture/nested-private.ts:7 Bearer fixture-nested-private-bearer`,
  type: "server_error",
  code: "fixture_nested_failure",
};
const failure = {
  type: "response.failed",
  response: { id: "resp-nested-redact", status: "failed", error: upstreamError },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in nested translated failure fixture"); }));
});
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

/**
 * Responses → Chat Completions translation with a nested response.failed
 * envelope. Secrets must not appear anywhere on the public wire.
 */
async function consume(chunks) {
  const onStreamComplete = vi.fn();
  const onCoherentTerminal = vi.fn();
  const onComplete = vi.fn();
  const onError = vi.fn();
  const streamController = createStreamController({ onComplete, onError });
  const upstream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  let reader;
  let timer;
  try {
    const result = await handleStreamingResponse({
      providerResponse: new Response(upstream, { headers: { "content-type": "text/event-stream" } }),
      provider: "codex",
      model: "gpt-fixture",
      targetFormat: FORMATS.OPENAI_RESPONSES,
      sourceFormat: FORMATS.OPENAI,
      credentials,
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      requestStartTime: Date.now(),
      streamController,
      onStreamComplete,
      onCoherentTerminal,
    });
    expect(result.success).toBe(true);
    reader = result.response.body.getReader();
    const drain = async () => {
      const parts = [];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        parts.push(next.value);
      }
      const output = new TextDecoder("utf-8", { fatal: true }).decode(await new Blob(parts).arrayBuffer());
      return { output, onStreamComplete, onCoherentTerminal, onComplete, onError };
    };
    return await Promise.race([
      drain(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Nested translated failure EOF deadline exceeded")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    streamController.abort("nested translated failure fixture cleanup");
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

function expectSecretExcluded(result) {
  for (const secret of secretTokens) {
    expect(result.output).not.toContain(secret);
  }
  expect(result.onStreamComplete).toHaveBeenCalledTimes(1);
  expect(result.onStreamComplete.mock.calls[0][0].upstreamError).toEqual(upstreamError);
  expect(result.onCoherentTerminal).not.toHaveBeenCalled();
  expect(result.onComplete).toHaveBeenCalledTimes(1);
  expect(result.onError).not.toHaveBeenCalled();
}

describe("PR #1276 nested response.failed redaction under TRANSLATE", () => {
  it("redacts a terminated nested response.failed frame on the whole public wire", async () => {
    const wire =
      `event: response.failed\ndata: ${JSON.stringify(failure)}\n\n`;
    const result = await consume([wire]);
    expectSecretExcluded(result);
  });

  it("redacts an unterminated nested response.failed EOF frame on the whole public wire", async () => {
    const wire =
      `event: response.failed\ndata: ${JSON.stringify(failure)}`;
    const result = await consume([wire]);
    expectSecretExcluded(result);
  });

  it("redacts a chunk-split nested response.failed envelope on the whole public wire", async () => {
    const wire =
      `event: response.failed\r\ndata: ${JSON.stringify(failure)}`;
    const bytes = encoder.encode(wire);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 1) {
      chunks.push(bytes.slice(offset, offset + 1));
    }
    const result = await consume(chunks);
    expectSecretExcluded(result);
  });
});
