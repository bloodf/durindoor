import { EventEmitter } from "node:events";
import zlib from "node:zlib";
import { afterEach, describe, it, expect, vi } from "vitest";

import { CursorExecutor, __setCursorHttp2ForTesting } from "../../open-sse/executors/cursor.js";
import { MAX_PROVIDER_BODY_BYTES } from "../../open-sse/config/runtimeConfig.js";

class FakeReq extends EventEmitter {
  destroyed = false;
  write() {}
  end() {}
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    queueMicrotask(() => this.emit("close"));
  }
}

function installFakeHttp2() {
  const req = new FakeReq();
  const client = Object.assign(new EventEmitter(), { request: () => req, close() {} });
  const restore = __setCursorHttp2ForTesting({ connect: () => client });
  return { req, restore };
}

const url = "https://agent.example.test/agent.v1.AgentService/Run";
let restore;
afterEach(() => {
  restore?.();
  vi.useRealTimers();
});

describe("Cursor AgentService stream limits", () => {
  it("rejects response headers with AbortError when aborted before headers", async () => {
    ({ restore } = installFakeHttp2());
    const controller = new AbortController();
    const session = new CursorExecutor().openAgentHttp2Stream(url, {}, controller.signal);
    controller.abort();
    await expect(session.responseHeaders).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects response headers when the stream closes before a response", async () => {
    const fake = installFakeHttp2();
    restore = fake.restore;
    const session = new CursorExecutor().openAgentHttp2Stream(url, {}, undefined);
    fake.req.emit("close");
    await expect(session.responseHeaders).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails a read that stays idle past the timeout", async () => {
    vi.useFakeTimers();
    ({ restore } = installFakeHttp2());
    const executor = new CursorExecutor();
    executor.config = { timeoutMs: 1000 };
    const session = executor.openAgentHttp2Stream(url, {}, undefined);
    const read = session.read();
    const assertion = expect(read).rejects.toThrow(/idle timed out/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  async function runWithFrame(frame) {
    const executor = new CursorExecutor();
    executor.openAgentHttp2Stream = () => ({
      responseHeaders: Promise.resolve({ ":status": 200 }),
      write() {}, end() {}, close() {},
      read: vi.fn().mockResolvedValueOnce({ value: frame, done: false }),
    });
    return executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "t", providerSpecificData: { machineId: "a".repeat(64) } },
    }).catch((e) => e);
  }

  it("rejects agent frames declaring more than the body limit", async () => {
    const header = Buffer.alloc(5);
    header.writeUInt32BE(MAX_PROVIDER_BODY_BYTES + 1, 1);
    const result = await runWithFrame(header);
    expect(String(result?.message ?? result)).toMatch(/body limit/);
  });

  it("caps gunzip output of compressed agent frames", async () => {
    const gz = zlib.gzipSync(Buffer.alloc(MAX_PROVIDER_BODY_BYTES + 1));
    const header = Buffer.alloc(5);
    header[0] = 0x01;
    header.writeUInt32BE(gz.length, 1);
    const result = await runWithFrame(Buffer.concat([header, gz]));
    expect(result).toBeInstanceOf(Error);
    expect(String(result.message)).toMatch(/larger than|limit|ERR_BUFFER_TOO_LARGE/i);
  });
});
