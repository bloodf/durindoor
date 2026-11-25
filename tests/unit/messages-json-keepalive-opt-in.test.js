import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_JSON_KEEPALIVE_THRESHOLD_MS,
  resolveJsonKeepaliveThresholdMs,
} from "../../open-sse/utils/earlyJsonKeepalive.js";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  initTranslators: vi.fn(async () => undefined),
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: mocks.initTranslators }));

const { POST } = await import("../../src/app/api/v1/messages/route.js");
const decoder = new TextDecoder();

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function nonStreamRequest() {
  return new Request("https://router.test/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-test", messages: [], stream: false }),
  });
}

function late429() {
  return Response.json(
    { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
    { status: 429, headers: { "retry-after": "7", "request-id": "req_late" } },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("non-streaming JSON keepalive is opt-in", () => {
  it("defaults to off and reads the DurinDoor name before the OmniRoute name", () => {
    expect(DEFAULT_JSON_KEEPALIVE_THRESHOLD_MS).toBe(0);
    expect(resolveJsonKeepaliveThresholdMs({})).toBe(0);
    expect(resolveJsonKeepaliveThresholdMs({ OMNIROUTE_NONSTREAM_KEEPALIVE_MS: "500" })).toBe(500);
    expect(resolveJsonKeepaliveThresholdMs({ DURINDOOR_NONSTREAM_KEEPALIVE_MS: "250", OMNIROUTE_NONSTREAM_KEEPALIVE_MS: "500" })).toBe(250);
    expect(resolveJsonKeepaliveThresholdMs({ DURINDOOR_NONSTREAM_KEEPALIVE_MS: "x", OMNIROUTE_NONSTREAM_KEEPALIVE_MS: "500" })).toBe(500);
    expect(resolveJsonKeepaliveThresholdMs({ DURINDOOR_NONSTREAM_KEEPALIVE_MS: "-1" })).toBe(0);
  });

  it("unset: a late 429 keeps its status and upstream headers", async () => {
    vi.stubEnv("DURINDOOR_NONSTREAM_KEEPALIVE_MS", "");
    vi.stubEnv("OMNIROUTE_NONSTREAM_KEEPALIVE_MS", "");
    vi.useFakeTimers();
    const upstream = deferred();
    mocks.handleChat.mockReturnValue(upstream.promise);

    let settled = false;
    const responsePromise = POST(nonStreamRequest()).then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);

    upstream.resolve(late429());
    const response = await responsePromise;
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("request-id")).toBe("req_late");
    expect((await response.json()).error.type).toBe("rate_limit_error");
  });

  it("set: whitespace first, then the late error is committed to 200 without upstream headers", async () => {
    vi.stubEnv("DURINDOOR_NONSTREAM_KEEPALIVE_MS", "100");
    vi.useFakeTimers();
    const upstream = deferred();
    mocks.handleChat.mockReturnValue(upstream.promise);

    const responsePromise = POST(nonStreamRequest());
    await vi.advanceTimersByTimeAsync(100);
    const response = await responsePromise;
    // Trade-off: status is already sent, so the 429 and its retry headers are lost.
    expect(response.status).toBe(200);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("request-id")).toBeNull();

    const reader = response.body.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe(" ");
    upstream.resolve(late429());
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value);
    }
    expect(JSON.parse(rest).error.type).toBe("rate_limit_error");
  });
});
