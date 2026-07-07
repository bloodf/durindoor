import { describe, expect, it, vi } from "vitest";

describe("direct egress dispatcher", () => {
  it("enables Happy Eyeballs for direct fetches", async () => {
    vi.resetModules();
    const { getDirectDispatcherOptionsForTest } = await import(
      "../../open-sse/utils/proxyFetch.js"
    );
    const options = getDirectDispatcherOptionsForTest();

    expect(options.connect.autoSelectFamily).toBe(true);
    expect(options.connect.autoSelectFamilyAttemptTimeout).toBe(1000);
  });

  it("preserves a caller-provided dispatcher when no proxy is selected", async () => {
    vi.resetModules();
    const customDispatcher = { custom: true };
    const fetchMock = vi.fn(async () => new Response("ok"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      await proxyAwareFetch("https://example.com/test", {
        dispatcher: customDispatcher,
      });
      const [, options] = fetchMock.mock.calls[0];
      expect(options.dispatcher).toBe(customDispatcher);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
