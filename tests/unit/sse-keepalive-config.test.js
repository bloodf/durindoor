import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SSE_KEEPALIVE_MS", () => {
  it.each([
    [undefined, 10_000],
    ["0", 0],
    ["2500", 2_500],
    ["invalid", 10_000],
    ["-1", 10_000],
  ])("parses %s as %d", async (raw, expected) => {
    if (raw === undefined) vi.stubEnv("SSE_KEEPALIVE_MS", undefined);
    else vi.stubEnv("SSE_KEEPALIVE_MS", raw);
    vi.resetModules();

    const { SSE_KEEPALIVE_MS } = await import("../../open-sse/config/runtimeConfig.js");

    expect(SSE_KEEPALIVE_MS).toBe(expected);
  });
});
