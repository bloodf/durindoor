import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const http2Binding = vi.hoisted(() => ({
  connect: vi.fn(),
  constants: { NGHTTP2_CANCEL: 8 },
}));
const requireHttp2 = vi.hoisted(() => vi.fn(() => http2Binding));

vi.mock("module", () => ({
  createRequire: vi.fn(() => requireHttp2),
}));

describe("Cursor executor CJS interop", () => {
  it("uses the createRequire-loaded http2 binding for executor requests", async () => {
    const request = new EventEmitter();
    request.write = vi.fn();
    request.end = vi.fn(() => queueMicrotask(() => {
      request.emit("response", { ":status": 418 });
      request.emit("end");
    }));
    request.close = vi.fn();
    request.destroy = vi.fn();

    const client = new EventEmitter();
    client.request = vi.fn(() => request);
    client.close = vi.fn();
    client.destroy = vi.fn();
    http2Binding.connect.mockReturnValue(client);

    const { CursorExecutor } = await import("../../open-sse/executors/cursor.js");
    const executor = new CursorExecutor();
    const result = await executor.execute({
      model: "cursor-model",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {
        accessToken: "token",
        providerSpecificData: { machineId: "machine" },
      },
      proxyOptions: { proxyMode: "direct", disableEnvProxy: true },
    });

    expect(requireHttp2).toHaveBeenCalledWith("http2");
    expect(http2Binding.connect).toHaveBeenCalledWith(new URL(executor.buildUrl()).origin);
    expect(client.request).toHaveBeenCalledOnce();
    expect(request.write).toHaveBeenCalledOnce();
    expect(request.end).toHaveBeenCalledOnce();
    expect(result.response.status).toBe(418);
  });
});
