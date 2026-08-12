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
  it("loads with createRequire and resolves the http2 binding", async () => {
    const cursor = await import("../../open-sse/executors/cursor.js");

    expect(cursor.CursorExecutor).toBeTypeOf("function");
    expect(requireHttp2).toHaveBeenCalledWith("http2");
    expect(requireHttp2.mock.results[0].value).toBe(http2Binding);
  });
});
