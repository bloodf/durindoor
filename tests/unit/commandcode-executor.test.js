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
      ndjson({ type: "finish" }),
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
