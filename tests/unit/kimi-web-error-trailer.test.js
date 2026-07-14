import { describe, it, expect, vi, afterEach } from "vitest";
import { getConnectError, KimiWebExecutor } from "../../open-sse/executors/kimi-web.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CHAT_URL = "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat";

afterEach(() => vi.clearAllMocks());

// Encode one Connect frame: 1-byte flags + 32-bit big-endian length + JSON body.
function frame(obj, flags = 0) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(json.length, 1);
  return new Uint8Array(Buffer.concat([header, json]));
}

function streamOf(...frames) {
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(f);
      // Deliberately DO NOT close: the executor must stop on its own markers.
    },
  });
}

const COMPLETED = { message: { status: "MESSAGE_STATUS_COMPLETED", role: "assistant" } };
const TEXT = { op: "append", mask: "block.text.content", block: { text: { content: "hello" } } };

describe("getConnectError", () => {
  it("returns null for a non-trailer frame (flag bit unset)", () => {
    expect(getConnectError(0, { error: { message: "x" } })).toBeNull();
  });

  it("returns null for a clean end-stream trailer with no error", () => {
    expect(getConnectError(0x02, {})).toBeNull();
    expect(getConnectError(0x02, null)).toBeNull();
  });

  it("returns the error message for an error trailer", () => {
    expect(getConnectError(0x02, { error: { message: "session expired" } })).toBe("session expired");
    expect(getConnectError(0x02, { error: { code: "unauthenticated" } })).toBe("unauthenticated");
    expect(getConnectError(0x02, { error: "raw string" })).toBe("raw string");
  });
});

describe("kimi-web non-streaming completion + trailers", () => {
  it("returns the answer without hanging when the stream stays open after completion", async () => {
    proxyAwareFetch.mockResolvedValue(
      new Response(streamOf(frame(TEXT), frame(COMPLETED)), { status: 200 }),
    );
    const executor = new KimiWebExecutor();
    const { response } = await executor.execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "kimi-auth=eyJ.test" },
      stream: false,
    });
    expect(response.status ?? 200).toBe(200);
    const json = await response.json();
    expect(json.choices[0].message.content).toBe("hello");
    expect(json.choices[0].finish_reason).toBe("stop");
  });

  it("surfaces a Connect error trailer as an error response, not a clean 200", async () => {
    proxyAwareFetch.mockResolvedValue(
      new Response(streamOf(frame({ error: { message: "session expired" } }, 0x02)), { status: 200 }),
    );
    const executor = new KimiWebExecutor();
    const { response } = await executor.execute({
      body: { model: "k2d6", messages: [{ role: "user", content: "hi" }] },
      credentials: { apiKey: "kimi-auth=eyJ.test" },
      stream: false,
    });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text.toLowerCase()).toContain("session expired");
  });
});
