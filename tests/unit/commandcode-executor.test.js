/**
 * Regression coverage for upstream 9router PR #3405: CommandCode embeds errors
 * in HTTP-200 NDJSON bodies, so the executor must classify only a bounded
 * pre-stream prefix before exposing normal output.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import {
  COMMANDCODE_PREFLIGHT_MAX_BYTES,
  COMMANDCODE_PREFLIGHT_MAX_FRAMES,
  CommandCodeExecutor,
  inspectAndWrapCommandCodeResponse,
  parseCommandCodeError,
  preflightCommandCodeResponse,
} from "../../open-sse/executors/commandcode.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function ndjson(event) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function responseFromChunks(chunks, hooks = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      hooks.onPull?.(index);
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel(reason) {
      hooks.onCancel?.(reason);
    },
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

async function readChunks(body) {
  const reader = body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("CommandCode HTTP-200 error preflight", () => {
  it("makes CommandCodeExecutor return fallback-visible HTTP failure", async () => {
    vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: responseFromChunks([ndjson({
        type: "error",
        error: { message: "CommandCode rejected this request", statusCode: 422 },
      })]),
      terminalProvenance: "upstream",
    });

    const result = await new CommandCodeExecutor().execute({ model: "test-model" });

    expect(result.response.status).toBe(422);
    expect(result.terminalProvenance).toBe("upstream");
  });

  it("returns normalized non-2xx JSON and honors an explicit upstream status", async () => {
    const upstream = responseFromChunks([ndjson({
      type: "error",
      error: { message: "CommandCode rejected this request", statusCode: 422 },
    })]);

    const response = await inspectAndWrapCommandCodeResponse(upstream, "test-model");

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        message: "CommandCode rejected this request",
        type: "invalid_request_error",
        code: 422,
      },
    });
  });

  it("classifies an error after control-only preamble frames", async () => {
    const response = await inspectAndWrapCommandCodeResponse(responseFromChunks([
      ndjson({ type: "start" }),
      ndjson({ type: "start-step" }),
      ndjson({ type: "error", message: "Model is overloaded" }),
    ]), "test-model");

    expect(response.status).toBe(503);
    expect((await response.json()).error.type).toBe("server_error");
  });

  it.each([
    ["Rate limit exceeded; retry later", 429, "rate_limit_error"],
    ["Model is overloaded; try again shortly", 503, "server_error"],
  ])("classifies %s", (message, statusCode, type) => {
    expect(parseCommandCodeError({ type: "error", message })).toEqual({
      statusCode,
      message,
      type,
    });
  });

  it("replays normal bytes with identical chunk boundaries and order", async () => {
    const chunks = [
      ndjson({ type: "start" }),
      ndjson({ type: "text-delta", text: "hello" }),
      ndjson({ type: "finish", finishReason: "stop" }),
    ];

    const response = await preflightCommandCodeResponse(responseFromChunks(chunks));
    const replayed = await readChunks(response.body);

    expect(replayed.map((chunk) => [...chunk])).toEqual(chunks.map((chunk) => [...chunk]));
    expect(decoder.decode(Uint8Array.from(replayed.flatMap((chunk) => [...chunk]))))
      .toBe(decoder.decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))));
  });

  it("does not reclassify an error after normal output has been released", async () => {
    const response = await inspectAndWrapCommandCodeResponse(responseFromChunks([
      ndjson({ type: "text-delta", text: "already sent" }),
      ndjson({ type: "error", error: { message: "late overload", statusCode: 503 } }),
    ]), "test-model");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("already sent");
    expect(body).toContain("CommandCode upstream stream failed");
  });

  it("stops a frameless prefix at the byte cap", async () => {
    const chunk = new Uint8Array(8 * 1024).fill(0x78);
    let pulls = 0;
    const chunks = Array.from(
      { length: COMMANDCODE_PREFLIGHT_MAX_BYTES / chunk.byteLength + 8 },
      () => chunk,
    );

    const response = await preflightCommandCodeResponse(responseFromChunks(chunks, {
      onPull: () => { pulls += 1; },
    }));

    expect(pulls).toBeLessThanOrEqual(COMMANDCODE_PREFLIGHT_MAX_BYTES / chunk.byteLength + 1);
    await response.body.cancel("test complete");
  });

  it("stops preamble inspection at the frame cap", async () => {
    const chunks = Array.from(
      { length: COMMANDCODE_PREFLIGHT_MAX_FRAMES + 8 },
      () => ndjson({ type: "start-step" }),
    );
    let pulls = 0;

    const response = await preflightCommandCodeResponse(responseFromChunks(chunks, {
      onPull: () => { pulls += 1; },
    }));

    expect(response.status).toBe(200);
    expect(pulls).toBeLessThanOrEqual(COMMANDCODE_PREFLIGHT_MAX_FRAMES + 1);
    await response.body.cancel("test complete");
  });
});

describe("CommandCode reference protocol compatibility (port of decolua/9router #4224)", () => {
  it("uses the current official CLI identity headers and drops the per-request session id", () => {
    const headers = new CommandCodeExecutor().buildHeaders({ apiKey: "user_test" });
    expect(headers).toMatchObject({
      Authorization: "Bearer user_test",
      "x-command-code-version": "1.54.2",
      "x-cli-environment": "production",
      "User-Agent": "cli",
    });
    expect(headers["x-session-id"]).toBeUndefined();
  });
});

describe("CommandCode retries a transient stream error (port of decolua/9router 092c84ea)", () => {
  it("retries once when the preflight classifies a 503 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    try {
      const executeSpy = vi.spyOn(BaseExecutor.prototype, "execute");
      executeSpy.mockResolvedValueOnce({
        response: responseFromChunks([ndjson({
          type: "error",
          error: { message: "Model is overloaded", statusCode: 503 },
        })]),
      });
      executeSpy.mockResolvedValueOnce({
        response: responseFromChunks([
          ndjson({ type: "start" }),
          ndjson({ type: "text-delta", text: "Recovered from overload" }),
          ndjson({ type: "finish", finishReason: "stop" }),
        ]),
      });

      const pending = new CommandCodeExecutor().execute({ model: "test-model" });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(executeSpy).toHaveBeenCalledTimes(2);
      expect(result.response.status).toBe(200);
      expect(result.response.ok).toBe(true);
      const body = await result.response.text();
      expect(body).toContain("Recovered from overload");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-retryable status like 422", async () => {
    const executeSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: responseFromChunks([ndjson({
        type: "error",
        error: { message: "Bad request", statusCode: 422 },
      })]),
    });

    const result = await new CommandCodeExecutor().execute({ model: "test-model" });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(422);
  });

  it("gives up after exhausting retries and returns the last failure", async () => {
    vi.useFakeTimers();
    try {
      // A fresh Response per call: reusing one across retries would hand the
      // second attempt an already-consumed stream (spurious empty success).
      const executeSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockImplementation(async () => ({
        response: responseFromChunks([ndjson({
          type: "error",
          error: { message: "Model is overloaded", statusCode: 503 },
        })]),
      }));

      const pending = new CommandCodeExecutor().execute({ model: "test-model" });
      await vi.runAllTimersAsync();
      const result = await pending;

      // Initial attempt + 2 retries = 3 total calls.
      expect(executeSpy).toHaveBeenCalledTimes(3);
      expect(result.response.status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });
});
