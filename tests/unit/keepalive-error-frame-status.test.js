// Once withEarlyStreamKeepalive commits a 200 SSE response, a later handler
// failure must still reach the client with its HTTP status and retry hint, in the
// client's own wire format (Responses event, Chat Completions data line, Anthropic
// error event).
import { afterEach, describe, expect, it, vi } from "vitest";
import { withEarlyStreamKeepalive } from "../../open-sse/utils/earlyStreamKeepalive.js";

const mocks = vi.hoisted(() => ({ handleChat: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => undefined) }));

const decoder = new TextDecoder();

afterEach(() => vi.useRealTimers());

function jsonError(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Commit the keepalive stream, then settle the handler and return the frames after the keepalive. */
async function lateFailure(options, settle) {
  vi.useFakeTimers();
  let resolve;
  let reject;
  const handler = new Promise((res, rej) => { resolve = res; reject = rej; });
  const pending = withEarlyStreamKeepalive(handler, { thresholdMs: 10, intervalMs: 60_000, ...options });
  await vi.advanceTimersByTimeAsync(10);
  const response = await pending;
  expect(response.status).toBe(200);
  vi.useRealTimers();
  settle({ resolve, reject });
  const text = await response.text();
  return text.replace(": keepalive\n\n", "");
}

function dataOf(frame) {
  const line = frame.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line.slice(6));
}

describe("post-keepalive error frames", () => {
  it("Responses: schema-correct error event with status, error_type and retry hint", async () => {
    const frame = await lateFailure({ errorFormat: "responses" }, ({ resolve }) => resolve(jsonError(
      429,
      { error: { message: "Slow down", type: "rate_limit_error", code: "rate_limit_exceeded" } },
      { "Retry-After": "30" },
    )));
    expect(frame.startsWith("event: error\ndata: ")).toBe(true);
    expect(dataOf(frame)).toEqual({
      type: "error",
      code: "rate_limit_exceeded",
      message: "Slow down",
      param: null,
      sequence_number: 1,
      status_code: 429,
      retry_after_seconds: 30,
      error_type: "rate_limit_error",
    });
  });

  it("Responses: HTTP-date Retry-After is clamped to an hour; no hint when absent", async () => {
    const future = new Date(Date.now() + 10 * 3_600_000).toUTCString();
    const clamped = await lateFailure({ errorFormat: "responses" }, ({ resolve }) =>
      resolve(jsonError(503, { error: { message: "busy" } }, { "Retry-After": future })));
    expect(dataOf(clamped).retry_after_seconds).toBe(3600);

    const permanent = await lateFailure({ errorFormat: "responses" }, ({ resolve }) =>
      resolve(jsonError(403, { error: { message: "model not allowed" } })));
    const data = dataOf(permanent);
    expect(data.status_code).toBe(403);
    expect(data).not.toHaveProperty("retry_after_seconds");
    expect(data).not.toHaveProperty("error_type");
    expect(data).not.toHaveProperty("error");
  });

  it("Responses: a thrown handler still yields a valid error event", async () => {
    const frame = await lateFailure({ errorFormat: "responses" }, ({ reject }) => reject(new Error("boom")));
    expect(dataOf(frame)).toMatchObject({ type: "error", sequence_number: 1, message: expect.any(String) });
  });

  it("Chat Completions: plain data line with the error object and status", async () => {
    const frame = await lateFailure({}, ({ resolve }) => resolve(jsonError(
      429,
      { error: { message: "Slow down", type: "rate_limit_error", code: "rate_limit_exceeded" } },
      { "Retry-After": "5" },
    )));
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame).not.toContain("event:");
    expect(dataOf(frame)).toEqual({
      error: {
        message: "Slow down",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
        status_code: 429,
        retry_after_seconds: 5,
      },
    });
  });

  it("Claude Messages: Anthropic error event typed from the status", async () => {
    const frame = await lateFailure({ errorFormat: "claude" }, ({ resolve }) => resolve(jsonError(
      429,
      { error: { message: "Slow down", type: "rate_limit_error" } },
      { "Retry-After": "7" },
    )));
    expect(frame.startsWith("event: error\ndata: ")).toBe(true);
    expect(dataOf(frame)).toEqual({
      type: "error",
      error: { type: "rate_limit_error", message: "Slow down", status_code: 429, retry_after_seconds: 7 },
    });

    const server = await lateFailure({ errorFormat: "claude" }, ({ resolve }) =>
      resolve(jsonError(500, { error: { message: "oops", type: "server_error" } })));
    expect(dataOf(server).error).toEqual({ type: "api_error", message: "oops", status_code: 500 });
  });

  it("fast path keeps the handler's real status", async () => {
    const response = await withEarlyStreamKeepalive(
      Promise.resolve(jsonError(429, { error: { message: "x" } }, { "Retry-After": "3" })),
      { errorFormat: "responses", thresholdMs: 1_000 },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(decoder.decode(new Uint8Array(await response.arrayBuffer()))).toContain("\"x\"");
  });
});

describe("route wiring", () => {
  async function routeLateFailure(path, body) {
    vi.useFakeTimers();
    let resolve;
    mocks.handleChat.mockReturnValue(new Promise((res) => { resolve = res; }));
    const { POST } = await import(`../../src/app/api/v1/${path}/route.js`);
    const pending = POST(new Request(`https://router.test/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", stream: true, ...body }),
    }));
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await pending;
    vi.useRealTimers();
    resolve(jsonError(429, { error: { message: "Slow down", type: "rate_limit_error" } }, { "Retry-After": "9" }));
    const text = await response.text();
    return text.slice(text.lastIndexOf("event: error"));
  }

  it("/v1/responses sends a Responses error event", async () => {
    const data = dataOf(await routeLateFailure("responses", { input: "hi" }));
    expect(data).toMatchObject({ type: "error", sequence_number: 1, status_code: 429, retry_after_seconds: 9 });
  });

  it("/v1/messages sends an Anthropic error event", async () => {
    const data = dataOf(await routeLateFailure("messages", { messages: [] }));
    expect(data).toEqual({
      type: "error",
      error: { type: "rate_limit_error", message: "Slow down", status_code: 429, retry_after_seconds: 9 },
    });
  });
});
